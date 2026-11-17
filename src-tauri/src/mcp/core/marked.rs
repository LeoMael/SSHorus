//! «Solo lo marcado» y usuarios protegidos dentro de las herramientas: lo que necesita leer del servidor
//! (rutas reales, /etc/passwd) antes de aplicar las reglas puras de `grants`, `protect` y `policy`.

use std::collections::BTreeMap;

use super::super::backend::Backend;
use super::super::grants::{self, Need, Task};
use super::super::policy::Access;
use super::super::protect::{self, Protected};
use super::{CatalogEntry, Fail, McpCore, Res, Target};

/// Tiempo para leer los usuarios protegidos del servidor.
const PASSWD_TIMEOUT_SECS: u32 = 15;

impl<B: Backend> McpCore<B> {
    /// Protegidos del servidor (los suyos y los globales) con su uid y carpeta personal. Si no existen en el
    /// servidor o no hay conexión, solo con el nombre y la carpeta habitual.
    async fn protected_users(&self, t: &Target) -> Vec<Protected> {
        let names = self.config.get().protected_of(&t.server.id);
        if names.is_empty() {
            return Vec::new();
        }
        let passwd = match &t.session {
            Some(s) => {
                let id = format!("mcp-users-{}", uuid::Uuid::new_v4().simple());
                let cmd = protect::passwd_command(&names);
                self.backend.exec(&s.id, &cmd, None, PASSWD_TIMEOUT_SECS, &id).await.map(|r| r.stdout).unwrap_or_default()
            }
            None => String::new(),
        };
        protect::resolve(&names, &passwd)
    }

    /// Comando (de cualquier nivel): rechaza si se cambia a un protegido (`sudo -u`, `su`…) y devuelve los
    /// protegidos que menciona (entonces se pregunta siempre).
    pub(super) async fn protected_in_command(&self, t: &Target, command: &str) -> Res<Vec<String>> {
        let users = self.protected_users(t).await;
        let switched = protect::switches_to(command, &users);
        if !switched.is_empty() {
            return Err(Fail::Denied(protect::denied_msg(&t.server.name, &switched)));
        }
        Ok(protect::mentioned(command, &users))
    }

    /// Comando de la Biblioteca que cambia algo: rechazado si un protegido está en sus variables (nombre,
    /// carpeta o uid) o si se cambia a él.
    pub(super) async fn check_catalog_protected(&self, t: &Target, vars: &BTreeMap<String, String>, command: &str) -> Res<()> {
        let users = self.protected_users(t).await;
        if users.is_empty() {
            return Ok(());
        }
        let values: Vec<&str> = vars.values().map(String::as_str).collect();
        let mut hit = protect::mentioned(&values.join("\n"), &users);
        hit.extend(protect::switches_to(command, &users));
        hit.sort();
        hit.dedup();
        if hit.is_empty() {
            Ok(())
        } else {
            Err(Fail::Denied(protect::denied_msg(&t.server.name, &hit)))
        }
    }

    /// Ruta real donde acabaría escribiendo `path` (el servidor sigue enlaces y «..»). Si aún no existe,
    /// la de su carpeta más el nombre.
    async fn real_write_path(&self, sid: &str, path: &str) -> Res<String> {
        let p = path.trim();
        if let Ok(real) = self.backend.realpath(sid, p).await {
            return Ok(real);
        }
        let (dir, name) = match p.rfind('/') {
            Some(0) => ("/", &p[1..]),
            Some(i) => (&p[..i], &p[i + 1..]),
            None => (".", p),
        };
        if matches!(name, "" | "." | "..") {
            return Err(Fail::Error(format!("No se pudo comprobar la ruta «{p}» en el servidor.")));
        }
        let real_dir = self
            .backend
            .realpath(sid, dir)
            .await
            .map_err(|_| Fail::Error(format!("La carpeta de «{p}» no existe en el servidor.")))?;
        Ok(if real_dir == "/" { format!("/{name}") } else { format!("{real_dir}/{name}") })
    }

    /// Lo que necesita escribir en `paths` (write_file, upload). Rechaza (en cualquier nivel) si cae en la
    /// carpeta personal de un protegido. Con «Solo lo marcado» comprueba las carpetas permitidas con rutas
    /// reales, así «..» y los enlaces simbólicos no sirven para salir de ellas.
    pub(super) async fn write_need(&self, t: &Target, sid: &str, paths: &[String]) -> Res<Need> {
        let cfg = self.config.get();
        let g = cfg.grants_of(&t.server.id);
        let check_folders = t.access == Access::Custom && !g.free_commands && g.tasks.contains(&Task::Files);
        let users = self.protected_users(t).await;
        if users.is_empty() && !check_folders {
            return Ok(Need::Write { paths: paths.to_vec(), outside: Vec::new() });
        }
        let mut real = Vec::with_capacity(paths.len());
        for p in paths {
            real.push(self.real_write_path(sid, p).await?);
        }
        if !users.is_empty() {
            let mut real_homes = Vec::new();
            for u in &users {
                if let Ok(h) = self.backend.realpath(sid, &u.home).await {
                    real_homes.push((u.name.clone(), h));
                }
            }
            let hit = protect::homes_hit(&real, &users, &real_homes);
            if !hit.is_empty() {
                return Err(Fail::Denied(protect::denied_msg(&t.server.name, &hit)));
            }
        }
        let outside = if check_folders {
            let mut folders = g.folders.clone();
            for f in &g.folders {
                if let Ok(r) = self.backend.realpath(sid, f).await {
                    folders.push(r);
                }
            }
            grants::outside(&real, &folders)
        } else {
            Vec::new()
        };
        Ok(Need::Write { paths: real, outside })
    }
}

/// Casilla que necesita un comando de la Biblioteca: la de su etiqueta, o «Comandos libres» si no tiene.
pub(super) fn catalog_need(entry: &CatalogEntry) -> Need {
    entry.perm.as_deref().and_then(Task::from_code).filter(|t| *t != Task::Files).map_or(Need::Free, Need::Task)
}
