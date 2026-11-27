//! «Solo lo marcado»: qué tareas puede hacer el asistente en un servidor (funciones puras, sin Tauri).
//!
//! - Cada tarea es una casilla: usuarios (crear, editar y borrar por separado), sitios web, contenedores,
//!   servicios, paquetes, cortafuegos y archivos (solo dentro de las carpetas elegidas).
//! - Los cambios van por herramientas concretas: `run_catalog_command` con comandos de la Biblioteca
//!   etiquetados con su tarea (`perm`), y `write_file` / `upload` dentro de las carpetas permitidas.
//! - `run_command` y los comandos sin tarea necesitan «Comandos libres». Con «Comandos libres» encendido
//!   las casillas ya no limitan (un comando libre puede hacer cualquier cosa).
//! - Las lecturas pasan igual que en «Solo lectura»; lo peligroso y sudo se preguntan igual que siempre.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Una casilla de «Solo lo marcado». El código (kebab-case) es el mismo que el `perm` del catálogo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Task {
    UsersCreate,
    UsersEdit,
    UsersDelete,
    Web,
    Containers,
    Services,
    Packages,
    Firewall,
    Files,
}

/// Todas las tareas, en el orden en que se muestran.
pub const ALL_TASKS: [Task; 9] = [
    Task::UsersCreate,
    Task::UsersEdit,
    Task::UsersDelete,
    Task::Web,
    Task::Containers,
    Task::Services,
    Task::Packages,
    Task::Firewall,
    Task::Files,
];

impl Task {
    pub fn code(self) -> &'static str {
        match self {
            Task::UsersCreate => "users-create",
            Task::UsersEdit => "users-edit",
            Task::UsersDelete => "users-delete",
            Task::Web => "web",
            Task::Containers => "containers",
            Task::Services => "services",
            Task::Packages => "packages",
            Task::Firewall => "firewall",
            Task::Files => "files",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Task::UsersCreate => "Usuarios: crear",
            Task::UsersEdit => "Usuarios: editar",
            Task::UsersDelete => "Usuarios: borrar",
            Task::Web => "Sitios web (Caddy y nginx)",
            Task::Containers => "Contenedores",
            Task::Services => "Servicios (systemd)",
            Task::Packages => "Paquetes",
            Task::Firewall => "Cortafuegos",
            Task::Files => "Archivos (carpetas elegidas)",
        }
    }

    /// Etiqueta `perm` de un comando del catálogo. Desconocida o vacía = sin tarea.
    pub fn from_code(code: &str) -> Option<Task> {
        ALL_TASKS.into_iter().find(|t| t.code() == code.trim())
    }
}

/// Casillas de un servidor con «Solo lo marcado».
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Grants {
    pub tasks: BTreeSet<Task>,
    /// Carpetas (absolutas) donde se puede escribir con la tarea «Archivos».
    pub folders: Vec<String>,
    /// `run_command` y cualquier comando. Apagado por defecto; encendido, las casillas ya no limitan.
    pub free_commands: bool,
}

impl Grants {
    pub fn is_empty(&self) -> bool {
        self.tasks.is_empty() && self.folders.is_empty() && !self.free_commands
    }

    /// Carpetas limpias: absolutas, sin «.» ni «..», sin barra final y sin repetir.
    pub fn sanitize(mut self) -> Self {
        let mut seen = BTreeSet::new();
        self.folders = self
            .folders
            .iter()
            .filter_map(|f| normalize_abs(f.trim()))
            .filter(|f| seen.insert(f.clone()))
            .collect();
        self
    }

    /// ¿Se permite lo que necesita la acción? Err = mensaje para el asistente.
    pub fn check(&self, server: &str, need: &Need) -> Result<(), String> {
        if self.free_commands {
            return Ok(());
        }
        match need {
            Need::Nothing => Ok(()),
            Need::Free => Err(free_msg(server, self)),
            Need::Task(t) if self.tasks.contains(t) => Ok(()),
            Need::Task(t) => Err(task_msg(server, *t)),
            Need::Write { .. } if !self.tasks.contains(&Task::Files) => Err(task_msg(server, Task::Files)),
            Need::Write { outside, .. } if !outside.is_empty() => Err(outside_msg(server, outside, &self.folders)),
            Need::Write { .. } => Ok(()),
        }
    }

    /// Lo que se le cuenta al asistente en `list_servers`.
    pub fn describe(&self) -> Value {
        let tasks: Vec<&str> = ALL_TASKS.into_iter().filter(|t| self.tasks.contains(t)).map(Task::code).collect();
        let labels: Vec<&str> = ALL_TASKS.into_iter().filter(|t| self.tasks.contains(t)).map(Task::label).collect();
        json!({
            "tasks": tasks,
            "taskLabels": labels,
            "folders": if self.tasks.contains(&Task::Files) { self.folders.clone() } else { Vec::new() },
            "freeCommands": self.free_commands,
            "howTo": if self.free_commands {
                "Comandos libres permitidos: run_command y cualquier comando (siempre con permiso del usuario)."
            } else {
                "Solo lo marcado: cambios con run_catalog_command (comandos cuyo «permission» está en tasks), \
                 write_file/upload dentro de folders, create_app_user (users-create) y deploy_app (containers o \
                 services). run_command no está permitido."
            },
        })
    }
}

/// Qué casilla necesita un cambio en «Solo lo marcado».
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Need {
    /// Nada: se permite como en «Solo lectura» (conectar, descargar, analizar…).
    Nothing,
    /// Un comando libre (`run_command` o un comando sin tarea).
    Free,
    Task(Task),
    /// Escribir en estas rutas reales; `outside` = las que quedan fuera de las carpetas permitidas.
    Write { paths: Vec<String>, outside: Vec<String> },
}

/// Plantillas de Ajustes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Template {
    /// Solo usuarios (crear, editar y borrar).
    Users,
    /// Solo sitios web.
    Web,
    /// Usuarios + web + contenedores + servicios.
    Deploy,
    /// Todas las casillas (sin comandos libres).
    All,
}

impl Template {
    pub fn tasks(self) -> BTreeSet<Task> {
        let users = [Task::UsersCreate, Task::UsersEdit, Task::UsersDelete];
        match self {
            Template::Users => users.into_iter().collect(),
            Template::Web => [Task::Web].into_iter().collect(),
            Template::Deploy => users.into_iter().chain([Task::Web, Task::Containers, Task::Services]).collect(),
            Template::All => ALL_TASKS.into_iter().collect(),
        }
    }

    /// Aplica la plantilla: casillas exactas y sin comandos libres; las carpetas se conservan.
    pub fn apply(self, g: &Grants) -> Grants {
        Grants { tasks: self.tasks(), folders: g.folders.clone(), free_commands: false }
    }
}

// ───────────────────────── Rutas ─────────────────────────

/// Ruta absoluta sin «.», «..» ni barras repetidas o finales. None si no es absoluta.
pub fn normalize_abs(path: &str) -> Option<String> {
    if !path.starts_with('/') {
        return None;
    }
    let mut parts: Vec<&str> = Vec::new();
    for p in path.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    Some(format!("/{}", parts.join("/")))
}

/// ¿`path` (real, absoluta) está dentro de `folder` (o es ella misma)?
pub fn within(folder: &str, path: &str) -> bool {
    let (Some(f), Some(p)) = (normalize_abs(folder), normalize_abs(path)) else {
        return false;
    };
    f == "/" || p == f || p.starts_with(&format!("{f}/"))
}

/// Rutas de `paths` que no están dentro de ninguna de `folders`.
pub fn outside(paths: &[String], folders: &[String]) -> Vec<String> {
    paths.iter().filter(|p| !folders.iter().any(|f| within(f, p))).cloned().collect()
}

// ───────────────────────── Mensajes para el asistente ─────────────────────────

const ENABLE_HINT: &str = "El usuario puede habilitarlo en SSHorus → Ajustes → Asistentes de IA (MCP).";

fn allowed_list(g: &Grants) -> String {
    let labels: Vec<&str> = ALL_TASKS.into_iter().filter(|t| g.tasks.contains(t)).map(Task::label).collect();
    if labels.is_empty() {
        "ninguna tarea".into()
    } else {
        labels.join(", ")
    }
}

pub fn task_msg(server: &str, t: Task) -> String {
    format!(
        "En «{server}» el asistente solo puede hacer lo marcado, y esto necesita «{}», que no está permitido. {ENABLE_HINT}",
        t.label()
    )
}

pub fn free_msg(server: &str, g: &Grants) -> String {
    format!(
        "En «{server}» el asistente solo puede hacer lo marcado ({}). Este comando necesita «Comandos libres», que no \
         está permitido. {ENABLE_HINT}",
        allowed_list(g)
    )
}

fn outside_msg(server: &str, outside: &[String], folders: &[String]) -> String {
    let allowed = if folders.is_empty() { "ninguna".to_string() } else { folders.join(", ") };
    format!(
        "En «{server}» solo se puede escribir dentro de las carpetas permitidas ({allowed}) y esto queda fuera: {}. \
         El usuario puede añadir la carpeta en SSHorus → Ajustes → Asistentes de IA (MCP).",
        outside.join(", ")
    )
}
