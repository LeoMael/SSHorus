//! El vigilante de una sincronización: mira la carpeta del PC cada poco, agrupa las ráfagas y
//! sube lo guardado con el motor de transferencias.
//!
//! Sondeo en vez de avisos del sistema (sin dependencias nuevas): cada `POLL` (más a menudo si
//! hay cambios esperando, más espaciado si la carpeta tarda en leerse). El recorrido va en
//! `spawn_blocking` para no frenar el resto del motor.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

use super::debounce::{Debouncer, QUIET_MS};
use super::filter::IgnoreRules;
use super::hub::Hub;
use super::model::{SyncInfo, SyncSpec, SyncState};
use super::plan::{deletes_allowed, remote_path, MAX_DELETES};
use super::remote::delete_files;
use super::snapshot::{diff, scan, Snapshot, MAX_FILES};
use crate::transfer::{Conflict, UploadItem, CLOSED_MSG};
use crate::types::TransferStatus;

const POLL: Duration = Duration::from_millis(1000);
/// Tope del sondeo cuando la carpeta es grande y tarda en leerse.
const MAX_POLL: Duration = Duration::from_secs(10);

pub fn too_many_warning() -> String {
    format!("La carpeta tiene más de {MAX_FILES} archivos: solo se vigilan los primeros. Añade carpetas a ignorar.")
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub struct Runner {
    hub: Arc<Hub>,
    id: String,
    session_id: String,
    spec: SyncSpec,
    root: PathBuf,
    rules: IgnoreRules,
    snap: Snapshot,
    deb: Debouncer,
    /// Archivo (ruta relativa) → trabajo de transferencia que lo está subiendo.
    inflight: HashMap<String, String>,
    error: Option<String>,
    scan_error: bool,
    warning: Option<String>,
    last: Option<(String, u64)>,
    connected: bool,
}

impl Runner {
    pub fn new(hub: Arc<Hub>, info: &SyncInfo, root: PathBuf, rules: IgnoreRules, snap: Snapshot, inflight: Vec<(String, String)>) -> Runner {
        Runner {
            hub,
            id: info.id.clone(),
            session_id: info.session_id.clone(),
            spec: info.spec.clone(),
            root,
            rules,
            snap,
            deb: Debouncer::default(),
            inflight: inflight.into_iter().collect(),
            error: None,
            scan_error: false,
            warning: info.warning.clone(),
            last: None,
            connected: true,
        }
    }

    /// Una vuelta: mirar el PC, ver cómo van las subidas y subir lo que ya está quieto.
    async fn tick(&mut self) {
        self.rescan().await;
        self.collect_finished();
        self.connected = self.hub.env.session(&self.session_id).await.is_ok();
        if self.connected
            && let Some(ready) = self.deb.take_ready(now_ms(), &self.inflight.keys().cloned().collect::<HashSet<_>>())
        {
            self.upload(&ready.changed);
            if !ready.removed.is_empty() && self.spec.delete_remote {
                self.delete(&ready.removed).await;
            }
        }
        self.publish();
    }

    async fn rescan(&mut self) {
        let (root, rules) = (self.root.clone(), self.rules.clone());
        match tokio::task::spawn_blocking(move || scan(&root, &rules, MAX_FILES)).await {
            Ok(Ok(new)) => {
                let changes = diff(&self.snap, &new);
                self.warning = if new.truncated { Some(too_many_warning()) } else { self.warning.take().filter(|w| *w != too_many_warning()) };
                self.snap = new;
                self.deb.push(changes, now_ms());
                if self.scan_error {
                    self.scan_error = false;
                    self.error = None;
                }
            }
            Ok(Err(msg)) => {
                self.error = Some(msg);
                self.scan_error = true;
            }
            Err(_) => {}
        }
    }

    fn collect_finished(&mut self) {
        if self.inflight.is_empty() {
            return;
        }
        let (rels, ids): (Vec<String>, Vec<String>) = self.inflight.iter().map(|(r, j)| (r.clone(), j.clone())).unzip();
        let states = self.hub.env.engine().job_states(&ids);
        for (rel, st) in rels.into_iter().zip(states) {
            match st {
                Some((TransferStatus::Done | TransferStatus::Skipped, _)) => {
                    self.inflight.remove(&rel);
                    if !self.scan_error {
                        self.error = None;
                    }
                    self.last = Some((rel, now_ms()));
                }
                // Se cayó la conexión: el motor lo reanuda solo al reconectar.
                Some((TransferStatus::Error, Some(msg))) if msg == CLOSED_MSG => {}
                Some((TransferStatus::Error, msg)) => {
                    self.inflight.remove(&rel);
                    self.error = Some(format!("{rel}: {}", msg.unwrap_or_else(|| "no se pudo subir".into())));
                }
                Some((TransferStatus::Canceled, _)) | None => {
                    self.inflight.remove(&rel);
                }
                Some(_) => {}
            }
        }
    }

    fn upload(&mut self, rels: &[String]) {
        let items: Vec<UploadItem> = rels
            .iter()
            .filter_map(|rel| {
                let st = self.snap.files.get(rel)?;
                Some(UploadItem {
                    local: self.root.join(rel),
                    remote: remote_path(&self.spec.remote_dir, rel),
                    name: rel.clone(),
                    size: st.size,
                })
            })
            .collect();
        if items.is_empty() {
            return;
        }
        let names: Vec<String> = items.iter().map(|i| i.name.clone()).collect();
        let (_, ids) = self.hub.env.engine().upload_files(&self.session_id, items, Conflict::Overwrite);
        self.inflight.extend(names.into_iter().zip(ids));
    }

    async fn delete(&mut self, rels: &[String]) {
        if !deletes_allowed(rels.len()) {
            self.warning = Some(format!(
                "No se borraron {} archivos en el servidor: son más de {MAX_DELETES} de golpe. Bórralos a mano si era lo que querías.",
                rels.len()
            ));
            return;
        }
        let Ok(ssh) = self.hub.env.session(&self.session_id).await else { return };
        if let Err(e) = delete_files(self.hub.env.sftp(), &ssh, &self.spec.remote_dir, rels).await {
            self.error = Some(format!("No se pudo borrar en el servidor: {e}"));
        }
    }

    fn publish(&self) {
        let pending = (self.deb.pending() + self.inflight.len()) as u32;
        let state = if !self.connected {
            SyncState::Waiting
        } else if pending > 0 {
            SyncState::Uploading
        } else if self.error.is_some() {
            SyncState::Error
        } else {
            SyncState::Idle
        };
        let (files, error, warning, last) = (self.snap.files.len() as u32, self.error.clone(), self.warning.clone(), self.last.clone());
        self.hub.update(&self.id, move |i| {
            i.state = state;
            i.pending = pending;
            i.files = files;
            i.error = error;
            i.warning = warning;
            if let Some((f, at)) = last {
                i.last_file = Some(f);
                i.last_at = Some(at);
            }
        });
    }
}

/// Espera tras una vuelta: corta si hay cambios esperando; más larga si leer la carpeta tarda.
pub fn next_wait(pending: bool, took: Duration) -> Duration {
    if pending {
        Duration::from_millis(QUIET_MS)
    } else {
        POLL.max(took * 5).min(MAX_POLL)
    }
}

pub async fn run(mut r: Runner, token: CancellationToken, paused: Arc<AtomicBool>) {
    let mut wait = POLL;
    loop {
        tokio::select! {
            _ = token.cancelled() => return,
            _ = tokio::time::sleep(wait) => {}
        }
        if paused.load(Ordering::Relaxed) {
            wait = POLL;
            continue;
        }
        let started = Instant::now();
        r.tick().await;
        wait = next_wait(r.deb.has_pending(), started.elapsed());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wait_adapts_to_pending_and_slow_scans() {
        assert_eq!(next_wait(true, Duration::from_secs(3)), Duration::from_millis(QUIET_MS));
        assert_eq!(next_wait(false, Duration::from_millis(10)), POLL);
        assert_eq!(next_wait(false, Duration::from_millis(600)), Duration::from_millis(3000));
        assert_eq!(next_wait(false, Duration::from_secs(5)), MAX_POLL);
    }
}
