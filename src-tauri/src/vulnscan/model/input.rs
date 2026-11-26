//! Entrada del análisis: salidas en bruto de las fases del servidor y el inventario.

use serde::{Deserialize, Serialize};

use super::ScanNote;

// ───────────── Entrada: salidas en bruto de las fases del servidor ─────────────

/// Salida de un comando del servidor, tal cual.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RawOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<u32>,
    pub timed_out: bool,
    pub truncated: bool,
}

/// Herramienta de seguridad de la distro (fase 3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DistroTool {
    /// `dnf updateinfo` (dnf4: RHEL/Rocky/Alma 8 y 9, Fedora vieja).
    Dnf4,
    /// `dnf advisory` (dnf5: Fedora 41+).
    Dnf5,
    /// `yum updateinfo` (CentOS 7, Amazon Linux 2): misma salida que dnf4.
    Yum,
    Debsecan,
    /// `pro api u.pro.security.cves.v1` (Ubuntu).
    Pro,
    /// `zypper list-patches` (openSUSE, SLES).
    Zypper,
}

impl DistroTool {
    pub fn label(self) -> &'static str {
        match self {
            DistroTool::Dnf4 => "dnf updateinfo",
            DistroTool::Dnf5 => "dnf advisory",
            DistroTool::Yum => "yum updateinfo",
            DistroTool::Debsecan => "debsecan",
            DistroTool::Pro => "Ubuntu Pro (pro api)",
            DistroTool::Zypper => "zypper list-patches",
        }
    }
}

/// Motor de contenedores.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Podman,
    Docker,
}

impl Engine {
    pub fn cmd(self) -> &'static str {
        match self {
            Engine::Podman => "podman",
            Engine::Docker => "docker",
        }
    }
}

/// Lectura de una imagen (fase 4).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ImageRaw {
    pub engine: Option<Engine>,
    /// Dueño del almacén (None = el usuario conectado o root sin elegir usuario).
    pub user: Option<String>,
    /// Salida de `images_list_script` de ese usuario y motor (imágenes y contenedores).
    /// Solo hace falta una vez por (motor, usuario): en el resto de imágenes puede ir vacía.
    pub listing: Option<String>,
    /// ID de la imagen leída (vacío si `output` es solo el listado).
    pub image_id: String,
    /// Salida de `image_script` (None si no se leyó: límite, cancelado…).
    pub output: Option<RawOutput>,
    /// Error del lado de la interfaz (p. ej. «tardó demasiado»).
    pub error: Option<String>,
}

/// Todo lo que la interfaz (o el MCP) recoge del servidor para un análisis.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScanInput {
    pub server_id: String,
    /// Fase 1 (`detect_script`).
    pub detect: RawOutput,
    /// Fase 2 (`inventory_script`).
    pub inventory: RawOutput,
    /// Fase 3: herramienta de la distro usada y su salida.
    pub distro_tool: Option<DistroTool>,
    pub distro_output: Option<RawOutput>,
    /// Fase 4.
    pub images: Vec<ImageRaw>,
    /// El análisis se hizo con root o sudo.
    pub elevated: bool,
    /// Consultar OSV.dev (desactivable en Ajustes).
    pub use_osv: bool,
    /// Avisos de las fases que corrió la interfaz (fallos, saltadas, sin sudo…).
    pub notes: Vec<ScanNote>,
    /// Duración de las fases del servidor (ms), para el informe.
    pub server_ms: u64,
}

// ───────────── Inventario ─────────────

/// Un paquete o programa instalado.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    /// Paquete binario (o el programa: «node»).
    pub name: String,
    /// Paquete fuente (Debian/RPM/Alpine «origen»). Igual que `name` si no se sabe.
    pub source: String,
    /// Versión instalada tal como la muestra el gestor (con epoch si lo tiene).
    pub version: String,
    /// Versión del paquete fuente (Debian) o la que se manda a OSV (RPM sin epoch).
    pub source_version: String,
    pub arch: Option<String>,
}

/// Gestor de paquetes del sistema o de una imagen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    Dpkg,
    Rpm,
    Apk,
    None,
}

/// Datos de `/etc/os-release`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OsRelease {
    pub id: String,
    pub id_like: Vec<String>,
    pub version_id: String,
    pub version: String,
    pub version_codename: String,
    pub pretty_name: String,
    pub name: String,
}
