//! El informe: lo que se sabe del servidor, sus programas, la explicación de la IA, la entrada del
//! historial y el detalle de un aviso.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{Finding, OsRelease, PackageManager, ScanNote, SourceInfo, Summary, Target};

/// Lo que se sabe del servidor.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HostInfo {
    pub os: OsRelease,
    pub kernel: String,
    pub arch: String,
    pub package_manager: Option<PackageManager>,
    /// Ecosistema OSV de la distro (None = no está en OSV).
    pub ecosystem: Option<String>,
    /// Corre dentro de un contenedor (el kernel es del anfitrión).
    pub in_container: bool,
    /// Herramientas encontradas: «trivy», «debsecan», «pro», «dnf», «zypper», «podman», «docker».
    pub tools: Vec<String>,
    /// Hace falta reiniciar: hay un kernel más nuevo instalado o la distro lo pide
    /// (`/var/run/reboot-required`).
    pub reboot_required: bool,
    /// Versión del kernel nuevo que se usará al reiniciar (si se sabe).
    pub reboot_kernel: Option<String>,
    /// Kernel con el que arranca por defecto (`grubby --default-kernel`, sin «/boot/vmlinuz-»).
    pub boot_kernel: Option<String>,
    /// Identificador del arranque actual (`/proc/sys/kernel/random/boot_id`): si cambia, el servidor
    /// se reinició después de este análisis.
    pub boot_id: Option<String>,
    /// Lo más nuevo que ofrecen los repositorios del servidor por paquete binario (`dnf check-update`).
    /// None = no se sabe (otra distro, o no se pudo leer).
    pub repo_upgrades: Option<BTreeMap<String, String>>,
    /// Hallazgos (clave) con versión corregida publicada que los repositorios aún no ofrecen
    /// (ver `repo.rs`). Solo tiene sentido con `repo_upgrades`.
    pub no_repo_fix: Vec<String>,
}

/// Programa clave encontrado (sudo, OpenSSH, nginx…, y runtimes de $HOME).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramInfo {
    pub name: String,
    pub path: String,
    pub version: Option<String>,
    /// Paquete dueño del binario (None = suelto).
    pub owner: Option<String>,
    /// Viene de un repositorio de terceros (no de la distro).
    pub third_party: bool,
    /// Ecosistema con el que se consultó como programa suelto.
    pub upstream_ecosystem: Option<String>,
}

/// Explicación de la IA guardada con el informe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExplanation {
    pub model: String,
    pub created_at: String,
    pub text: String,
}

/// Informe de un análisis.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub id: String,
    pub server_id: String,
    /// RFC 3339.
    pub created_at: String,
    pub duration_ms: u64,
    pub elevated: bool,
    pub host: HostInfo,
    pub sources: Vec<SourceInfo>,
    pub targets: Vec<Target>,
    pub programs: Vec<ProgramInfo>,
    pub findings: Vec<Finding>,
    pub summary: Summary,
    pub notes: Vec<ScanNote>,
    pub ai: Option<AiExplanation>,
    /// Lo que se mandó a OSV en el último lote (para «ver qué se envía»): solo ecosistema, nombre y versión.
    #[serde(default)]
    pub osv_sample: Vec<OsvQueryView>,
}

/// Una consulta a OSV tal como se envía (para mostrarla).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OsvQueryView {
    pub ecosystem: String,
    pub name: String,
    pub version: String,
}

/// Resumen de un análisis para la lista del historial.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportMeta {
    pub id: String,
    pub created_at: String,
    pub duration_ms: u64,
    pub elevated: bool,
    pub summary: Summary,
    pub sources: Vec<String>,
    pub distro: String,
    pub has_ai: bool,
}

impl Report {
    pub fn meta(&self) -> ReportMeta {
        ReportMeta {
            id: self.id.clone(),
            created_at: self.created_at.clone(),
            duration_ms: self.duration_ms,
            elevated: self.elevated,
            summary: self.summary.clone(),
            sources: self.sources.iter().filter(|s| s.used).map(|s| s.label.clone()).collect(),
            distro: if self.host.os.pretty_name.is_empty() { self.host.os.id.clone() } else { self.host.os.pretty_name.clone() },
            has_ai: self.ai.is_some(),
        }
    }
}

/// Detalle de una vulnerabilidad para el panel lateral (de la caché de OSV).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VulnDetail {
    pub id: String,
    pub summary: Option<String>,
    pub details: Option<String>,
    pub aliases: Vec<String>,
    pub published: Option<String>,
    pub modified: Option<String>,
    pub references: Vec<String>,
}
