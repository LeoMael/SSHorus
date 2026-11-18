//! Parámetros de las herramientas (los lee `rmcp` para describirlas al asistente).

use std::collections::BTreeMap;

use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;

#[derive(Debug, Default, Deserialize, JsonSchema)]
pub struct NoParams {}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ServerParams {
    /// Nombre o id del servidor (ver list_servers).
    pub server: String,
    /// Conexión concreta (ver list_sessions). Si no se da, se usa la más reciente de ese servidor.
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct VulnReportParams {
    /// Nombre o id del servidor (ver list_servers).
    pub server: String,
    /// Hallazgos a mostrar, de más a menos grave (1-100, por defecto 20).
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct AuditReportParams {
    /// Nombre o id del servidor (ver list_servers).
    pub server: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct VulnScanParams {
    /// Nombre o id del servidor (ver list_servers). Hace falta una conexión abierta (connect).
    pub server: String,
    /// Conexión concreta (ver list_sessions). Si no se da, se usa la más reciente de ese servidor.
    #[serde(default)]
    pub session_id: Option<String>,
    /// Tiempo límite en segundos (60-1800, por defecto 600). Al vencer se detiene también en el servidor.
    #[serde(default)]
    pub timeout_secs: Option<u32>,
    /// Hallazgos a mostrar, de más a menos grave (1-100, por defecto 20).
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ConnectParams {
    /// Nombre o id del servidor guardado en SSHorus.
    pub server: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RunCommandParams {
    /// Nombre o id del servidor.
    pub server: String,
    #[serde(default)]
    pub session_id: Option<String>,
    /// Comando de shell exacto. No interactivo (nada de top, vim o tail -f).
    pub command: String,
    /// Tiempo límite en segundos (1-600, por defecto 60). Al vencer se detiene el proceso remoto.
    #[serde(default)]
    pub timeout_secs: Option<u32>,
    /// KB máximos de salida por flujo (stdout y stderr; por defecto 64, máximo 512).
    #[serde(default)]
    pub max_output_kb: Option<u32>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CatalogListParams {
    /// Filtra por categoría (p. ej. «Podman», «Análisis del sistema», «Mis comandos»).
    #[serde(default)]
    pub category: Option<String>,
    /// Palabras a buscar en el nombre, la descripción o el comando.
    #[serde(default)]
    pub query: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CatalogRunParams {
    pub server: String,
    #[serde(default)]
    pub session_id: Option<String>,
    /// id del comando (ver list_catalog).
    pub id: String,
    /// Valores de las variables {{nombre}} de la plantilla.
    #[serde(default)]
    pub vars: BTreeMap<String, String>,
    #[serde(default)]
    pub timeout_secs: Option<u32>,
    #[serde(default)]
    pub max_output_kb: Option<u32>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PathParams {
    pub server: String,
    #[serde(default)]
    pub session_id: Option<String>,
    /// Ruta en el servidor (absoluta o relativa a la carpeta personal).
    pub path: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListDirParams {
    pub server: String,
    #[serde(default)]
    pub session_id: Option<String>,
    /// Carpeta del servidor. Vacío = carpeta personal.
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ReadFileParams {
    pub server: String,
    #[serde(default)]
    pub session_id: Option<String>,
    pub path: String,
    /// Byte desde el que leer (para archivos grandes, por trozos).
    #[serde(default)]
    pub offset: Option<u64>,
    /// Bytes máximos a leer (por defecto 65536, máximo 1048576).
    #[serde(default)]
    pub max_bytes: Option<u64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct WriteFileParams {
    pub server: String,
    #[serde(default)]
    pub session_id: Option<String>,
    pub path: String,
    /// Contenido completo del archivo (texto, máximo 1 MiB). Se guarda de forma atómica.
    pub content: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct UploadParams {
    pub server: String,
    #[serde(default)]
    pub session_id: Option<String>,
    /// Archivos o carpetas de este PC (rutas absolutas).
    pub local_paths: Vec<String>,
    /// Carpeta de destino en el servidor.
    pub remote_dir: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DownloadParams {
    pub server: String,
    #[serde(default)]
    pub session_id: Option<String>,
    /// Archivos o carpetas del servidor.
    pub remote_paths: Vec<String>,
    /// Carpeta de destino en este PC (ruta absoluta que ya exista).
    pub local_dir: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct TransferStatusParams {
    /// Lote devuelto por upload o download. Si no se da, todas las transferencias visibles.
    #[serde(default)]
    pub batch_id: Option<String>,
}
