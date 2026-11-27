//! Desplegar con la IA, lecturas: `get_deploy_guide` (la receta), `check_dns` y `deploy_status`. Los cambios
//! (`create_app_user`, `deploy_app`) están en `deploy_change.rs`; la lógica pura, en `mcp/deploy/`.

use std::collections::BTreeMap;

use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;
use tokio_util::sync::CancellationToken;

use super::super::backend::Backend;
use super::super::deploy::{check, dns, guide, status};
use super::super::policy::Action;
use super::{Fail, McpCore, Rec, Res};

/// Tiempo para las comprobaciones (DNS y HTTP tienen su propio límite de 3-8 s cada una).
const PROBE_TIMEOUT_SECS: u32 = 60;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CheckDnsParams {
    /// Nombre o id del servidor (ver list_servers). Hace falta una conexión abierta (connect).
    pub server: String,
    #[serde(default)]
    pub session_id: Option<String>,
    /// Dominio que se quiere usar (p. ej. app.ejemplo.com), sin http:// ni puerto.
    pub domain: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DeployStatusParams {
    /// Nombre o id del servidor (ver list_servers). Hace falta una conexión abierta (connect).
    pub server: String,
    #[serde(default)]
    pub session_id: Option<String>,
    /// Puerto donde escucha la app: ¿escucha? ¿responde en http://127.0.0.1:puerto/?
    #[serde(default)]
    pub port: Option<u32>,
    /// Dominio: ¿responde por HTTP y HTTPS con un certificado válido? ¿cuándo caduca?
    #[serde(default)]
    pub domain: Option<String>,
    /// Servicio systemd del sistema (p. ej. caddy o nginx): ¿activo?
    #[serde(default)]
    pub service: Option<String>,
    /// Usuario de la app: ¿existe, tiene linger, su systemd en marcha y procesos?
    #[serde(default)]
    pub user: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateAppUserParams {
    /// Nombre o id del servidor (ver list_servers). Hace falta una conexión abierta (connect).
    pub server: String,
    #[serde(default)]
    pub session_id: Option<String>,
    /// Nombre del usuario nuevo (p. ej. el de la app: «blog»). No puede existir ya.
    pub user: String,
    /// Llave pública SSH (opcional) para que el usuario pueda entrar con ese usuario.
    #[serde(default)]
    pub public_key: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DeployAppParams {
    /// Nombre o id del servidor (ver list_servers). Hace falta una conexión abierta (connect).
    pub server: String,
    #[serde(default)]
    pub session_id: Option<String>,
    /// Usuario de la app (creado con create_app_user). Nunca root ni el usuario conectado.
    pub user: String,
    /// Nombre de la app: servicio «<name>.service», contenedor y carpeta ~/apps/<name>.
    pub name: String,
    /// Imagen del contenedor (docker.io/org/app:1.2 o, con build o image_archive, localhost/<name>:latest).
    #[serde(default)]
    pub image: Option<String>,
    /// Construir la imagen en el servidor desde copy_from (Containerfile o Dockerfile).
    #[serde(default)]
    pub build: bool,
    /// Archivo subido con `podman save` (ruta del servidor) que se carga antes de arrancar.
    #[serde(default)]
    pub image_archive: Option<String>,
    /// Programa en vez de contenedor: orden de arranque (relativa = dentro de ~/apps/<name>).
    #[serde(default)]
    pub exec_start: Option<String>,
    /// Carpeta o archivo subido (con upload, en tu carpeta o /tmp) que se copia a ~/apps/<name>/.
    #[serde(default)]
    pub copy_from: Option<String>,
    /// Puerto del servidor donde escucha la app (solo en 127.0.0.1 salvo public=true).
    #[serde(default)]
    pub port: Option<u32>,
    /// Puerto dentro del contenedor, si es distinto de port.
    #[serde(default)]
    pub container_port: Option<u32>,
    /// Escuchar en todas las interfaces: solo para desplegar con IP:puerto, sin Caddy ni nginx.
    #[serde(default)]
    pub public: bool,
    /// Variables de entorno de la app (se guardan en un archivo 600 del usuario de la app).
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Volúmenes «subcarpeta:/ruta/en/el/contenedor» (la subcarpeta queda en ~/apps/<name>/).
    #[serde(default)]
    pub volumes: Vec<String>,
    /// Parar la app y quitar su servicio (deja ~/apps/<name>). Solo con user y name.
    #[serde(default)]
    pub remove: bool,
    /// Tiempo límite en segundos (60-600, por defecto 600): descargar o construir una imagen tarda.
    #[serde(default)]
    pub timeout_secs: Option<u32>,
}

impl<B: Backend> McpCore<B> {
    pub(super) fn deploy_guide(&self, rec: &mut Rec) -> Res<String> {
        rec.entry.detail = "receta de despliegue".into();
        Ok(guide::DEPLOY_GUIDE.to_string())
    }

    pub(super) async fn check_dns(
        &self,
        p: CheckDnsParams,
        rec: &mut Rec,
        cancel: &CancellationToken,
    ) -> Res<String> {
        let domain = check::domain(&p.domain).map_err(Fail::Error)?;
        rec.entry.detail = format!("comprobar DNS de {domain}");
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        let sid = t.session_id()?.to_string();
        self.authorize(
            rec,
            &t,
            Action::read(format!("check_dns\n{domain}")),
            "",
            "",
            None,
        )
        .await?;
        let r = self
            .exec_raw(
                rec,
                &sid,
                &dns::probe_command(&domain, &t.server.host),
                None,
                PROBE_TIMEOUT_SECS,
                cancel,
            )
            .await?;
        let probe = dns::parse(&r.stdout, &t.server.host);
        rec.entry.message = Some(format!("{:?}", dns::verdict(&probe)));
        let mut out = dns::render(&domain, &probe);
        self.redact_known(&t, &sid, &mut out, &[]).await;
        Ok(out)
    }

    pub(super) async fn deploy_status(
        &self,
        p: DeployStatusParams,
        rec: &mut Rec,
        cancel: &CancellationToken,
    ) -> Res<String> {
        let q = status::StatusQuery {
            port: p.port.map(check::port).transpose().map_err(Fail::Error)?,
            domain: p
                .domain
                .as_deref()
                .map(check::domain)
                .transpose()
                .map_err(Fail::Error)?,
            unit: p
                .service
                .as_deref()
                .map(check::unit)
                .transpose()
                .map_err(Fail::Error)?,
            user: p
                .user
                .as_deref()
                .map(check::user_name)
                .transpose()
                .map_err(Fail::Error)?,
        };
        if q.is_empty() {
            return Err(Fail::Error(
                "Di qué comprobar: port, domain, service y/o user.".into(),
            ));
        }
        rec.entry.detail = "comprobar despliegue".into();
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        let sid = t.session_id()?.to_string();
        self.authorize(rec, &t, Action::read("deploy_status"), "", "", None)
            .await?;
        let r = self
            .exec_raw(
                rec,
                &sid,
                &status::probe_command(&q),
                None,
                PROBE_TIMEOUT_SECS,
                cancel,
            )
            .await?;
        let lines = status::lines(&q, &status::parse(&r.stdout));
        let mut out = status::render(&lines);
        rec.entry.message = out.lines().next().map(str::to_string);
        self.redact_known(&t, &sid, &mut out, &[]).await;
        Ok(out)
    }
}
