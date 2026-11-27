//! Una entrada del historial por servidor.

use serde::{Deserialize, Serialize};

/// De dónde sale la entrada (lo demás del historial lo lee la interfaz de sus propios registros).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventSource {
    /// Línea escrita en la terminal (solo si el usuario lo activó).
    Terminal,
    /// Comando de la Biblioteca, ejecutado aparte o enviado a la terminal.
    Library,
    /// «Ejecutar en varios servidores».
    Multirun,
    /// Tarea en segundo plano terminada.
    Job,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEvent {
    /// Lo pone el motor al guardar.
    #[serde(default)]
    pub id: String,
    /// Unix ms. Lo pone el motor al guardar.
    #[serde(default)]
    pub at: u64,
    pub source: EventSource,
    /// Qué se hizo, en una línea («Reiniciar nginx», el comando escrito…).
    pub title: String,
    /// El comando completo u otros datos.
    #[serde(default)]
    pub detail: String,
    /// None = no se sabe (p. ej. una línea de la terminal).
    #[serde(default)]
    pub ok: Option<bool>,
    /// Salida o error, recortado.
    #[serde(default)]
    pub result: String,
    /// Nombre del servidor en ese momento (para exportar).
    #[serde(default)]
    pub server_name: String,
}
