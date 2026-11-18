//! Recorrido de bajada: carpetas remotas por anchura, carpetas locales y archivos a la cola.

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use russh_sftp::client::error::Error as SftpError;
use russh_sftp::protocol::{File as SftpFile, StatusCode};

use super::super::copy::{self, CopyError};
use super::super::paths::{
    local_file_name, local_io_message, local_name_key, numbered_name, remote_basename, remote_join, remote_kind,
    safe_remote_name, RemoteKind,
};
use super::super::pool::{Chan, Lease};
use super::state::{Kind, NewJob, WalkSpec};
use super::{Engine, CLOSED_MSG};
use crate::ssh::SshSession;
use crate::types::TransferDirection;

impl Engine {
    pub(super) async fn walk_download_root(self: &Arc<Self>, batch_id: &str, session_id: &str, remote: String, local_dir: &Path) {
        if self.batch_canceled(batch_id) {
            return;
        }
        let mut name = remote_basename(&remote);
        if !safe_remote_name(&name) {
            name = "raiz".into();
        }
        let local = local_dir.join(local_file_name(&name));
        let down = TransferDirection::Download;
        let walk_kind = Kind::Walk(WalkSpec::DownloadRoot {
            remote: remote.clone(),
            local_dir: local_dir.to_path_buf(),
        });
        let attrs = match self.session_lease(session_id).await {
            Err(msg) => Err(msg),
            Ok((s, mut lease)) => match lease.chan().raw.stat(remote.clone()).await {
                Ok(a) => Ok(a.attrs),
                Err(e) => Err(walk_msg(e, &mut lease, &s).0),
            },
        };
        let attrs = match attrs {
            Ok(a) => a,
            Err(msg) => {
                let job = Self::make_job(batch_id, session_id, down, &local, &remote, name, 0);
                self.add_jobs(batch_id, vec![Self::error_job(job, msg, walk_kind)]);
                return;
            }
        };
        if remote_kind(attrs.permissions) == RemoteKind::Dir {
            self.walk_download_tree(batch_id, session_id, remote, local, name).await;
        } else {
            let job = Self::make_job(batch_id, session_id, down, &local, &remote, name, attrs.size.unwrap_or(0));
            self.add_jobs(
                batch_id,
                vec![NewJob {
                    job,
                    kind: Kind::File { mode: attrs.permissions, mtime: attrs.mtime },
                }],
            );
        }
    }

    /// Recorrido remoto por anchura: crea cada carpeta local y encola sus archivos en cuanto
    /// se listan (las transferencias empiezan sin esperar al recorrido completo).
    pub(super) async fn walk_download_tree(self: &Arc<Self>, batch_id: &str, session_id: &str, remote: String, local: PathBuf, rel: String) {
        let down = TransferDirection::Download;
        let mut queue: VecDeque<(String, PathBuf, String)> = VecDeque::from([(remote, local, rel)]);
        let mut lease: Option<(Arc<SshSession>, Lease)> = None;
        while let Some((r, l, rel)) = queue.pop_front() {
            if self.batch_canceled(batch_id) {
                return;
            }
            let walk_err = |r: &str, l: &Path, rel: &str, msg: String| {
                let job = Self::make_job(batch_id, session_id, down, l, r, format!("{rel}/"), 0);
                Self::error_job(
                    job,
                    msg,
                    Kind::Walk(WalkSpec::DownloadDir {
                        remote: r.to_string(),
                        local: l.to_path_buf(),
                        rel: rel.to_string(),
                    }),
                )
            };
            // Nunca escribir a través de un enlace simbólico local que ocupe el nombre.
            if tokio::fs::symlink_metadata(&l).await.is_ok_and(|m| m.file_type().is_symlink()) {
                let msg = "En el destino hay un enlace simbólico con ese nombre".to_string();
                self.add_jobs(batch_id, vec![walk_err(&r, &l, &rel, msg)]);
                continue;
            }
            if let Err(e) = tokio::fs::create_dir_all(&l).await {
                self.add_jobs(batch_id, vec![walk_err(&r, &l, &rel, local_io_message(&e))]);
                continue;
            }
            if lease.is_none() {
                match self.session_lease(session_id).await {
                    Ok(pair) => lease = Some(pair),
                    Err(msg) => {
                        // Sin conexión: todo lo pendiente queda como error reintentable.
                        let mut errs = vec![walk_err(&r, &l, &rel, msg.clone())];
                        for (r2, l2, rel2) in queue.drain(..) {
                            errs.push(walk_err(&r2, &l2, &rel2, msg.clone()));
                        }
                        self.add_jobs(batch_id, errs);
                        return;
                    }
                }
            }
            let Some((s, le)) = lease.as_mut() else { return };
            let entries = match read_dir(le.chan(), &r).await {
                Ok(v) => v,
                Err(e) => {
                    let (msg, transient) = walk_msg(e, le, s);
                    if transient {
                        lease = None;
                    }
                    self.add_jobs(batch_id, vec![walk_err(&r, &l, &rel, msg)]);
                    continue;
                }
            };
            let mut jobs = Vec::new();
            let mut seen = HashSet::new();
            // Nombres locales ya usados en esta carpeta: en Windows dos nombres remotos pueden
            // acabar iguales (`a:b` y `a_b`, o `A.txt` y `a.txt`); el segundo se numera.
            let mut used_local = HashSet::new();
            for f in entries {
                if !safe_remote_name(&f.filename) || !seen.insert(f.filename.clone()) {
                    continue;
                }
                let rpath = remote_join(&r, &f.filename);
                let base = local_file_name(&f.filename);
                let mut lname = base.clone();
                let mut n = 2;
                while !used_local.insert(local_name_key(&lname)) {
                    lname = numbered_name(&base, n);
                    n += 1;
                }
                let lpath = l.join(&lname);
                let frel = format!("{rel}/{}", f.filename);
                let a = &f.attrs;
                match remote_kind(a.permissions) {
                    RemoteKind::Dir => queue.push_back((rpath, lpath, frel)),
                    RemoteKind::File | RemoteKind::Unknown => {
                        let job = Self::make_job(batch_id, session_id, down, &lpath, &rpath, frel, a.size.unwrap_or(0));
                        jobs.push(NewJob { job, kind: Kind::File { mode: a.permissions, mtime: a.mtime } });
                    }
                    // Enlaces: se recrean (no se siguen, así no hay bucles).
                    RemoteKind::Link => {
                        let job = Self::make_job(batch_id, session_id, down, &lpath, &rpath, frel, 0);
                        jobs.push(NewJob { job, kind: Kind::Link { target: None, mtime: a.mtime } });
                    }
                    // Sockets, FIFO, dispositivos: se omiten.
                    RemoteKind::Other => {}
                }
            }
            self.add_jobs(batch_id, jobs);
        }
    }
}

/// Mensaje de un error SFTP durante un recorrido (y si fue un corte del canal). Marca el
/// canal roto ante cortes y devuelve `CLOSED_MSG` si cayó la conexión entera (así
/// `resume_session` repite el recorrido).
fn walk_msg(e: SftpError, lease: &mut Lease, session: &SshSession) -> (String, bool) {
    match copy::sftp_err(e) {
        CopyError::Transient(m) => {
            lease.mark_broken();
            if session.is_closed() { (CLOSED_MSG.into(), true) } else { (m, true) }
        }
        CopyError::Fatal(m) => (m, false),
        CopyError::Stopped | CopyError::Disconnected => ("Cancelado".into(), false),
    }
}

/// Lista una carpeta remota completa (sin "." ni "..").
async fn read_dir(chan: &Chan, path: &str) -> Result<Vec<SftpFile>, SftpError> {
    let handle = chan.raw.opendir(path.to_string()).await?.handle;
    let mut out = Vec::new();
    let res = loop {
        match chan.raw.readdir(handle.clone()).await {
            Ok(name) => out.extend(name.files.into_iter().filter(|f| f.filename != "." && f.filename != "..")),
            Err(SftpError::Status(s)) if s.status_code == StatusCode::Eof => break Ok(()),
            Err(e) => break Err(e),
        }
    };
    let _ = chan.raw.close(handle).await;
    res.map(|_| out)
}
