//! Recorrido de subida: carpetas remotas por niveles y archivos locales a la cola.

use std::path::PathBuf;
use std::sync::Arc;

use russh_sftp::client::error::Error as SftpError;

use super::super::copy::{self, CopyError};
use super::super::paths::{local_io_message, local_root_name, remote_join, walk_local};
use super::super::pool::Chan;
use super::state::{Kind, NewJob, WalkSpec};
use super::{Engine, CLOSED_MSG};
use crate::types::TransferDirection;

impl Engine {
    pub(super) async fn walk_upload_root(self: &Arc<Self>, batch_id: &str, session_id: &str, local: PathBuf, remote_dir: &str) {
        if self.batch_canceled(batch_id) {
            return;
        }
        let name = local_root_name(&local);
        let remote_root = remote_join(remote_dir, &name);
        let up = TransferDirection::Upload;
        let walk_kind = Kind::Walk(WalkSpec::UploadRoot {
            local: local.clone(),
            remote_dir: remote_dir.to_string(),
        });
        let meta = match tokio::fs::metadata(&local).await {
            Ok(m) => m,
            Err(e) => {
                let job = Self::make_job(batch_id, session_id, up, &local, &remote_root, name, 0);
                self.add_jobs(batch_id, vec![Self::error_job(job, local_io_message(&e), walk_kind)]);
                return;
            }
        };
        if meta.is_file() {
            let job = Self::make_job(batch_id, session_id, up, &local, &remote_root, name, meta.len());
            self.add_jobs(batch_id, vec![NewJob { job, kind: Kind::File { mode: None, mtime: None } }]);
            return;
        }
        if !meta.is_dir() {
            let job = Self::make_job(batch_id, session_id, up, &local, &remote_root, name, 0);
            self.add_jobs(
                batch_id,
                vec![Self::error_job(job, "No es un archivo ni una carpeta".into(), Kind::Info)],
            );
            return;
        }

        let root = local.clone();
        let plan = match tokio::task::spawn_blocking(move || walk_local(&root)).await {
            Ok(p) => p,
            Err(_) => return,
        };
        let dir_job = || Self::make_job(batch_id, session_id, up, &local, &remote_root, format!("{name}/"), 0);

        // 1) Estructura de carpetas (por niveles, en paralelo dentro de cada nivel).
        if let Err(msg) = self.remote_mkdirs(session_id, remote_dir, &plan.dirs).await {
            self.add_jobs(batch_id, vec![Self::error_job(dir_job(), msg, walk_kind)]);
            return;
        }
        if self.batch_canceled(batch_id) {
            return;
        }

        // 2) Archivos a la cola.
        let mut jobs: Vec<NewJob> = Vec::with_capacity(plan.files.len() + plan.errors.len());
        for f in plan.files {
            let remote = remote_join(remote_dir, &f.rel);
            let job = Self::make_job(batch_id, session_id, up, &f.path, &remote, f.rel, f.size);
            jobs.push(NewJob { job, kind: Kind::File { mode: None, mtime: None } });
        }
        for l in plan.links {
            let remote = remote_join(remote_dir, &l.rel);
            let job = Self::make_job(batch_id, session_id, up, &l.path, &remote, l.rel, 0);
            jobs.push(NewJob {
                job,
                kind: Kind::Link { target: Some(l.target), mtime: None },
            });
        }
        for (rel, msg) in plan.errors {
            let remote = remote_join(remote_dir, &rel);
            let path = local.parent().map(|p| p.join(&rel)).unwrap_or_else(|| PathBuf::from(&rel));
            let job = Self::make_job(batch_id, session_id, up, &path, &remote, rel, 0);
            jobs.push(Self::error_job(job, msg, Kind::Info));
        }
        self.add_jobs(batch_id, jobs);
    }

    /// Crea `dirs` (relativas a `remote_dir`, padres antes que hijos). Error solo si falla la raíz.
    async fn remote_mkdirs(&self, session_id: &str, remote_dir: &str, dirs: &[String]) -> Result<(), String> {
        if dirs.is_empty() {
            return Ok(());
        }
        let (session, mut lease) = self.session_lease(session_id).await?;
        let mut levels: Vec<Vec<&String>> = Vec::new();
        for d in dirs {
            let depth = d.matches('/').count();
            if levels.len() <= depth {
                levels.resize_with(depth + 1, Vec::new);
            }
            levels[depth].push(d);
        }
        for (i, level) in levels.iter().enumerate() {
            let chan: &Chan = lease.chan();
            let paths: Vec<String> = level.iter().map(|d| remote_join(remote_dir, d)).collect();
            let mut results: Vec<(String, Result<(), SftpError>)> = Vec::with_capacity(paths.len());
            for group in paths.chunks(32) {
                let futs: Vec<_> = group.iter().map(|p| copy::remote_mkdir(chan, p)).collect();
                let outs = futures::future::join_all(futs).await;
                results.extend(group.iter().cloned().zip(outs));
            }
            for (path, r) in results {
                if let Err(e) = r {
                    let msg = match copy::sftp_err(e) {
                        CopyError::Transient(m) => {
                            lease.mark_broken();
                            m
                        }
                        CopyError::Fatal(m) => m,
                        CopyError::Stopped | CopyError::Disconnected => "Cancelado".into(),
                    };
                    if session.is_closed() {
                        return Err(CLOSED_MSG.into());
                    }
                    if i == 0 {
                        return Err(format!("No se pudo crear la carpeta {path}: {msg}"));
                    }
                    // Subcarpetas: cada archivo intentará crear su carpeta (mkdir -p) al subir.
                    log::warn!("mkdir {path}: {msg}");
                }
            }
        }
        Ok(())
    }
}
