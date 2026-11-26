//! Gravedad, fuentes, objetivos analizados, hallazgos, recuentos y avisos del análisis.

use serde::{Deserialize, Serialize};

use super::Engine;

// ───────────── Informe ─────────────

/// Gravedad unificada (de mayor a menor).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
    /// Sin clasificar.
    Unknown,
}

impl Severity {
    pub fn label(self) -> &'static str {
        match self {
            Severity::Critical => "crítica",
            Severity::High => "alta",
            Severity::Medium => "media",
            Severity::Low => "baja",
            Severity::Unknown => "sin clasificar",
        }
    }
}

/// De dónde sale un hallazgo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceId {
    Osv,
    Distro,
    Trivy,
}

/// Qué se analizó: el sistema, los programas sueltos o una imagen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TargetKind {
    System,
    Runtime,
    Image,
}

/// Contenedor que usa una imagen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerRef {
    pub id: String,
    pub name: String,
    pub state: String,
}

/// Datos de una imagen analizada.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ImageInfo {
    pub engine: Option<Engine>,
    /// ID corto (12).
    pub id: String,
    /// repositorio:etiqueta (puede haber varias o ninguna).
    pub tags: Vec<String>,
    pub containers: Vec<ContainerRef>,
    /// Distro de dentro de la imagen («Debian GNU/Linux 12»).
    pub os: Option<String>,
    /// Cómo se leyó: «montada», «rpm de la imagen», «docker cp», «Trivy 0.76.2».
    pub method: Option<String>,
}

/// Algo que se analizó (el sistema, los runtimes del usuario, una imagen).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    /// "system", "runtime", "image:<motor>:<usuario>:<id>".
    pub key: String,
    pub kind: TargetKind,
    /// «Sistema», «Programas sueltos», «Imagen nginx:1.25 (a1b2c3d4e5f6)».
    pub label: String,
    /// Dueño (imágenes de otro usuario o de root).
    pub user: Option<String>,
    pub ecosystem: Option<String>,
    pub packages: u32,
    pub image: Option<ImageInfo>,
    /// Qué fuentes lo cubrieron.
    pub sources: Vec<SourceId>,
    /// Si no se pudo leer, por qué.
    pub error: Option<String>,
}

/// Un hallazgo: una vulnerabilidad (CVE o aviso sin CVE) en un paquete de un objetivo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// Clave única en el informe: `<id>|<paquete>|<objetivo>`.
    pub key: String,
    /// CVE-… o, si no hay CVE, el aviso (DSA-…, FEDORA-…, GHSA-…).
    pub id: String,
    /// Otros ids de la misma vulnerabilidad (DEBIAN-CVE-…, ids de OSV).
    pub aliases: Vec<String>,
    /// Avisos de la distro que la arreglan (DSA-…, RLSA-…, FEDORA-…, USN-…).
    pub advisories: Vec<String>,
    /// Paquete (fuente en Debian/RPM/Alpine; el programa en los sueltos).
    pub package: String,
    /// Paquetes binarios instalados de ese paquete fuente (para el comando de actualizar).
    pub binaries: Vec<String>,
    pub installed: String,
    pub fixed: Option<String>,
    pub has_fix: bool,
    pub severity: Severity,
    /// Gravedad según la distro, en su texto original («Important», «low», «unimportant»).
    pub distro_severity: Option<String>,
    pub cvss: Option<f64>,
    pub cvss_vector: Option<String>,
    /// Debian lo marca «unimportant»: oculto por defecto.
    pub unimportant: bool,
    /// Estado del arreglo según la fuente (Trivy `Status`, `fix_status` de Ubuntu…).
    pub status: Option<String>,
    /// Título corto (la descripción completa se pide aparte a la caché de OSV).
    pub summary: Option<String>,
    pub target: String,
    pub sources: Vec<SourceId>,
    pub kernel: bool,
    pub ecosystem: Option<String>,
    /// Es un programa sin paquete de la distro (versión de origen): resultado aproximado.
    pub upstream: bool,
    /// Ya está arreglado en el kernel nuevo instalado: solo falta reiniciar (ver `kernel.rs`).
    #[serde(default)]
    pub needs_reboot: bool,
}

/// Recuento por gravedad.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Summary {
    pub critical: u32,
    pub high: u32,
    pub medium: u32,
    pub low: u32,
    pub unknown: u32,
    pub total: u32,
    pub with_fix: u32,
    /// Ocultos por defecto («unimportant» de Debian); no cuentan en el resto.
    pub unimportant: u32,
}

/// Una fuente usada y cómo fue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub id: SourceId,
    /// «OSV.dev», «dnf updateinfo», «Trivy 0.76.2».
    pub label: String,
    pub used: bool,
    /// Por qué no se usó o qué pasó.
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteLevel {
    Info,
    Warn,
    Error,
}

/// Aviso del análisis («Sin sudo: no se ven…», «OSV no disponible»…).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanNote {
    /// Fase: "detect", "inventory", "distro", "images", "osv", "merge".
    pub phase: String,
    pub level: NoteLevel,
    pub text: String,
}

impl ScanNote {
    pub fn new(phase: &str, level: NoteLevel, text: impl Into<String>) -> Self {
        ScanNote { phase: phase.into(), level, text: text.into() }
    }
}
