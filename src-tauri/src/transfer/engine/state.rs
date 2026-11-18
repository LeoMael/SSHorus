//! Tipos internos de la cola: trabajos, lotes y estado compartido del motor.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use super::super::copy::Ctrl;
use super::super::policy::{Conflict, ConflictQuestion};
use crate::types::TransferJob;

/// Cómo repetir un recorrido de carpeta que falló.
#[derive(Clone, Debug)]
pub(super) enum WalkSpec {
    UploadRoot { local: PathBuf, remote_dir: String },
    DownloadRoot { remote: String, local_dir: PathBuf },
    DownloadDir { remote: String, local: PathBuf, rel: String },
}

#[derive(Clone, Debug)]
pub(super) enum Kind {
    /// Copia de un archivo. `mode`/`mtime`: atributos remotos (bajadas).
    File { mode: Option<u32>, mtime: Option<u32> },
    /// Enlace simbólico a recrear. Subida: `target` del enlace local. Bajada: se lee con
    /// `readlink` al ejecutar (`target` = None); `mtime` del enlace remoto.
    Link { target: Option<String>, mtime: Option<u32> },
    /// Recorrido que falló; "reintentar" lo repite.
    Walk(WalkSpec),
    /// Aviso no reintentable (p. ej. carpeta local ilegible).
    Info,
}

pub(super) struct Entry {
    pub(super) job: TransferJob,
    pub(super) kind: Kind,
    pub(super) ctrl: Option<Arc<Ctrl>>,
    /// El destino se tocó alguna vez (cancelar lo borra).
    pub(super) touched: bool,
    /// Se pidió reanudar mientras se estaba pausando.
    pub(super) resume_after_stop: bool,
    /// Respuesta del usuario a un conflicto (manda sobre la política del lote).
    pub(super) decision: Option<Conflict>,
    pub(super) dirty: bool,
    pub(super) last_bytes: u64,
}

pub(super) struct Batch {
    pub(super) jobs: Vec<String>,
    pub(super) policy: Conflict,
    pub(super) paused: bool,
    pub(super) canceled: bool,
    pub(super) walkers: usize,
}

pub(super) struct State {
    pub(super) order: Vec<String>,
    pub(super) jobs: HashMap<String, Entry>,
    pub(super) batches: HashMap<String, Batch>,
    /// Cola por sesión (sessionId → ids).
    pub(super) queues: HashMap<String, VecDeque<String>>,
    pub(super) running: Vec<String>,
    /// Sesiones caídas esperando reconexión (desde cuándo).
    pub(super) down: HashMap<String, Instant>,
    /// Sesiones cerradas definitivamente (lo que falle después no espera).
    pub(super) closed: HashSet<String>,
    /// Preguntas de conflicto pendientes (jobId → pregunta). Esos trabajos quedan `Queued`
    /// fuera de la cola (no ocupan turno) hasta que se responda.
    pub(super) questions: HashMap<String, ConflictQuestion>,
    pub(super) dirty: Vec<String>,
    pub(super) last_tick: Instant,
}

impl State {
    /// Encola un trabajo en la cola de su sesión.
    pub(super) fn enqueue(&mut self, id: &str, front: bool) {
        let Some(sid) = self.jobs.get(id).map(|e| e.job.session_id.clone()) else { return };
        let q = self.queues.entry(sid).or_default();
        if front {
            q.push_front(id.to_string());
        } else {
            q.push_back(id.to_string());
        }
    }

    pub(super) fn mark(&mut self, id: &str) {
        if let Some(e) = self.jobs.get_mut(id)
            && !e.dirty
        {
            e.dirty = true;
            self.dirty.push(id.to_string());
        }
    }

    /// ids de trabajos o de lotes → ids de trabajos (sin duplicados, en orden).
    pub(super) fn expand(&self, ids: &[String]) -> Vec<String> {
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for id in ids {
            if self.jobs.contains_key(id) {
                if seen.insert(id.clone()) {
                    out.push(id.clone());
                }
            } else if let Some(b) = self.batches.get(id) {
                for j in &b.jobs {
                    if seen.insert(j.clone()) {
                        out.push(j.clone());
                    }
                }
            }
        }
        out
    }
}

pub(super) struct NewJob {
    pub(super) job: TransferJob,
    pub(super) kind: Kind,
}

/// Resultado correcto de un trabajo.
#[derive(Debug)]
pub(super) enum Outcome {
    Copied(u64),
    Skipped(String),
    /// El destino existe y hay que preguntar (el trabajo suelta su turno).
    Ask(Box<ConflictQuestion>),
}
