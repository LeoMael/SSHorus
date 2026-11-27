//! Desplegar con la IA, cambios: `create_app_user` y `deploy_app`. Los dos van como root (sudo, con la
//! contraseña que pone SSHorus), muestran el resumen y el script en el diálogo y preguntan siempre (salvo
//! «Aceptar automáticamente: todo»). En «Solo lo marcado» necesitan su casilla: «Usuarios: crear» y
//! «Contenedores» o «Servicios». Los usuarios protegidos, root y el usuario conectado se rechazan.

use tokio_util::sync::CancellationToken;

use super::super::backend::Backend;
use super::super::deploy::app_script::{self, ImageSource, Run};
use super::super::deploy::{check, user_script};
use super::super::grants::{self, Need, Task};
use super::super::policy::Action;
use super::super::template::shell_quote;
use super::deploy::{CreateAppUserParams, DeployAppParams};
use super::deploy_spec::spec_from;
use super::elevation::{NoPassword, SUDO_CANCELED_MSG, SudoAnswer, SudoPurpose, no_sudo_msg};
use super::output::{clip_middle, exec_summary, format_exec};
use super::{Fail, McpCore, Rec, Res, Target};
use crate::types::ExecResult;

const SUDO_REASON: &str = "usa sudo (permisos de administrador)";
/// Tiempo de `create_app_user` (s) y por defecto de `deploy_app`.
const USER_TIMEOUT_SECS: u32 = 60;
const DEFAULT_DEPLOY_SECS: u32 = 600;
/// Salida máxima devuelta a la IA.
const MAX_OUT: usize = 16 * 1024;

impl<B: Backend> McpCore<B> {
    pub(super) async fn create_app_user(
        &self,
        p: CreateAppUserParams,
        rec: &mut Rec,
        cancel: &CancellationToken,
    ) -> Res<String> {
        let user = check::user_name(&p.user).map_err(Fail::Error)?;
        let key = p
            .public_key
            .as_deref()
            .filter(|k| !k.trim().is_empty())
            .map(check::public_key)
            .transpose()
            .map_err(Fail::Error)?;
        rec.entry.detail = format!("crear usuario de app {user}");
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        let sid = t.session_id()?.to_string();
        self.refuse_user(&t, &user)?;
        let script = user_script::create_user_script(&user, key.as_deref());
        let shown = format!(
            "Usuario nuevo: {user}\nSin contraseña y sin sudo; linger (sus servicios siguen sin sesión), subuid/subgid para Podman sin root y ~/apps.{}\n\n{}",
            if key.is_some() {
                "\nPodrá entrar por SSH con la llave indicada."
            } else {
                ""
            },
            script
        );
        let action = Action::change(format!("create_app_user\n{user}"))
            .with_need(Need::Task(Task::UsersCreate))
            .with_danger(vec![SUDO_REASON.into()]);
        self.authorize(
            rec,
            &t,
            action,
            "quiere crear un usuario para una app",
            &shown,
            None,
        )
        .await?;
        let r = self
            .run_root_script(rec, &t, &sid, &script, USER_TIMEOUT_SECS, cancel)
            .await?;
        let mut out = format_exec(&r, MAX_OUT);
        self.redact_known(&t, &sid, &mut out, &[]).await;
        rec.entry.message = Some(exec_summary(&r));
        match (r.exit_code, user_script::parse_done(&r.stdout)) {
            (Some(0), Some((uid, home))) => Ok(format!(
                "Usuario «{user}» creado en «{}» (uid {uid}, carpeta {home}): sin sudo, con linger y ~/apps. Siguiente paso: \
                 subir el código (upload) y deploy_app con user=\"{user}\".\n\n{out}",
                t.server.name
            )),
            _ => Err(Fail::Error(format!(
                "No se pudo crear el usuario «{user}».\n\n{out}"
            ))),
        }
    }

    pub(super) async fn deploy_app(
        &self,
        p: DeployAppParams,
        rec: &mut Rec,
        cancel: &CancellationToken,
    ) -> Res<String> {
        let user = check::user_name(&p.user).map_err(Fail::Error)?;
        let name = check::app_name(&p.name).map_err(Fail::Error)?;
        rec.entry.detail = format!(
            "{} {name} (usuario {user})",
            if p.remove {
                "quitar app"
            } else {
                "desplegar app"
            }
        );
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        let sid = t.session_id()?.to_string();
        self.refuse_user(&t, &user)?;
        if p.remove {
            return self.remove_app(&t, &sid, &user, &name, rec, cancel).await;
        }
        let mut spec = spec_from(&p, user.clone(), name.clone()).map_err(Fail::Error)?;
        let task = if matches!(spec.run, Run::Container { .. }) {
            Task::Containers
        } else {
            Task::Services
        };
        let mut danger = vec![SUDO_REASON.to_string()];
        if spec.public && spec.port.is_some() {
            danger.push("publica el puerto de la app en todas las interfaces".into());
        }
        let action = Action::change(format!("deploy_app\n{user}\n{name}"))
            .with_need(Need::Task(task))
            .with_danger(danger);
        self.precheck(&t, action.clone())?;
        if let Some(src) = spec.copy_from.take() {
            spec.copy_from = Some(self.uploaded_path(&t, &sid, &src, "copy_from").await?);
        }
        if let Run::Container {
            source: ImageSource::Archive(f),
            ..
        } = &mut spec.run
        {
            *f = self.uploaded_path(&t, &sid, f, "image_archive").await?;
        }
        let script = app_script::deploy_script(&spec);
        let shown = format!(
            "{}\n\nUnidad ~/.config/systemd/user/{}:\n{}\n\n{script}",
            spec.describe(),
            spec.unit_name(),
            spec.unit_lines().join("\n")
        );
        self.authorize(rec, &t, action, "quiere desplegar una app", &shown, None)
            .await?;
        let timeout = p.timeout_secs.unwrap_or(DEFAULT_DEPLOY_SECS).clamp(60, 600);
        let r = self
            .run_root_script(rec, &t, &sid, &script, timeout, cancel)
            .await?;
        let mut out = format_exec(&r, MAX_OUT);
        self.redact_known(&t, &sid, &mut out, &[]).await;
        rec.entry.message = Some(exec_summary(&r));
        let where_ = spec
            .port
            .map(|p| format!(" en el puerto {p}"))
            .unwrap_or_default();
        match app_script::parse_state(&r.stdout).as_deref() {
            Some("active") if r.exit_code == Some(0) => Ok(format!(
                "App «{name}» en marcha{where_} como servicio {} del usuario {user}. Comprueba con deploy_status; para \
                 actualizar, vuelve a llamar a deploy_app; para quitarla, deploy_app con remove=true.\n\n{}",
                spec.unit_name(),
                clip_middle(&out, 4000)
            )),
            _ => Err(Fail::Error(format!(
                "La app «{name}» no quedó en marcha.\n\n{out}"
            ))),
        }
    }

    async fn remove_app(
        &self,
        t: &Target,
        sid: &str,
        user: &str,
        name: &str,
        rec: &mut Rec,
        cancel: &CancellationToken,
    ) -> Res<String> {
        let script = app_script::remove_script(user, name);
        let shown = format!(
            "Parar y quitar el servicio {name}.service del usuario {user} y sus variables. Se dejan ~/apps/{name} (código y datos).\n\n{script}"
        );
        // Se quita igual que se puso: con cualquiera de las dos casillas.
        let g = self.config.get().grants_of(&t.server.id);
        let task = if g.tasks.contains(&Task::Services) {
            Task::Services
        } else {
            Task::Containers
        };
        let action = Action::change(format!("deploy_app\nremove\n{user}\n{name}"))
            .with_need(Need::Task(task))
            .with_danger(vec![SUDO_REASON.into(), "detiene un servicio".into()]);
        self.authorize(
            rec,
            t,
            action,
            "quiere quitar una app desplegada",
            &shown,
            None,
        )
        .await?;
        let r = self
            .run_root_script(rec, t, sid, &script, USER_TIMEOUT_SECS, cancel)
            .await?;
        let mut out = format_exec(&r, MAX_OUT);
        self.redact_known(t, sid, &mut out, &[]).await;
        rec.entry.message = Some(exec_summary(&r));
        match app_script::parse_state(&r.stdout).as_deref() {
            Some("removed") => Ok(format!(
                "App «{name}» parada y sin servicio. Su carpeta ~/apps/{name} sigue en el servidor.\n\n{out}"
            )),
            _ => Err(Fail::Error(format!(
                "No se pudo quitar la app «{name}».\n\n{out}"
            ))),
        }
    }

    /// root, el usuario conectado y los protegidos no sirven como usuario de una app.
    fn refuse_user(&self, t: &Target, user: &str) -> Res<()> {
        if user == t.server.username {
            return Err(Fail::Denied(format!(
                "«{user}» es el usuario con el que SSHorus está conectado: la app va con un usuario aparte (create_app_user)."
            )));
        }
        let protected = self.config.get().protected_of(&t.server.id);
        if protected.contains(user) {
            return Err(Fail::Denied(super::super::protect::denied_msg(
                &t.server.name,
                &[user.to_string()],
            )));
        }
        Ok(())
    }

    /// Ruta real de algo subido: tiene que estar en la carpeta del usuario conectado o en /tmp o /var/tmp.
    async fn uploaded_path(&self, t: &Target, sid: &str, path: &str, what: &str) -> Res<String> {
        let real = self.backend.realpath(sid, path).await.map_err(|_| {
            Fail::Error(format!(
                "{what}: no existe «{path}» en el servidor. Súbelo antes con upload."
            ))
        })?;
        let home = self.backend.realpath(sid, ".").await.unwrap_or_default();
        let allowed = ["/tmp", "/var/tmp"]
            .iter()
            .any(|d| grants::within(d, &real))
            || (!home.is_empty() && home != "/" && grants::within(&home, &real));
        if !allowed {
            return Err(Fail::Denied(format!(
                "{what} debe estar en la carpeta de «{}» ({home}) o en /tmp: sube ahí los archivos con upload.",
                t.server.username
            )));
        }
        Ok(real)
    }

    /// Ejecuta un script ya aprobado como root: con sudo (SSHorus pone la contraseña) o tal cual si la
    /// conexión ya es root.
    async fn run_root_script(
        &self,
        rec: &mut Rec,
        t: &Target,
        sid: &str,
        script: &str,
        timeout: u32,
        cancel: &CancellationToken,
    ) -> Res<ExecResult> {
        let as_root = format!("sudo sh -c {}", shell_quote(script));
        match self.ask_sudo(rec, t, sid, SudoPurpose::Command).await? {
            SudoAnswer::Canceled => Err(Fail::Denied(SUDO_CANCELED_MSG.into())),
            SudoAnswer::NotNeeded(NoPassword::NoSudo) => {
                Err(Fail::Error(no_sudo_msg(&t.server.name, &t.server.username)))
            }
            SudoAnswer::NotNeeded(NoPassword::Root) => {
                self.exec_raw(
                    rec,
                    sid,
                    &format!("sh -c {}", shell_quote(script)),
                    None,
                    timeout,
                    cancel,
                )
                .await
            }
            SudoAnswer::NotNeeded(NoPassword::NoPasswd) => {
                self.exec_raw(rec, sid, &as_root, None, timeout, cancel)
                    .await
            }
            SudoAnswer::Password(pw) => {
                self.exec_sudo_raw(rec, t, sid, &as_root, &pw, timeout, cancel)
                    .await
            }
        }
    }
}
