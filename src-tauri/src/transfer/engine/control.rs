//! Acciones del usuario sobre trabajos o lotes: pausar, reanudar, cancelar y reintentar.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use super::super::copy::{STOP_CANCEL, STOP_PAUSE};
use super::state::{Kind, WalkSpec};
use super::{now_ms, Engine};
use crate::types::TransferStatus;

impl Engine {
    pub fn pause(self: &Arc<Self>, ids: &[String]) {
        let mut answered = Vec::new();
        {
            let mut st = self.lock();
            for id in ids {
                if let Some(b) = st.batches.get_mut(id) {
                    b.paused = true;
                }
            }
            for id in st.expand(ids) {
                let Some(e) = st.jobs.get_mut(&id) else { continue };
                match e.job.status {
                    TransferStatus::Running => {
                        e.resume_after_stop = false;
                        if let Some(c) = &e.ctrl {
                            c.stop_with(STOP_PAUSE);
                        }
                    }
                    TransferStatus::Queued => {
                        e.job.status = TransferStatus::Paused;
                        e.job.speed = 0.0;
                        // Si esperaba una respuesta, al reanudar se vuelve a preguntar.
                        if st.questions.remove(&id).is_some() {
                            if let Some(e) = st.jobs.get_mut(&id) {
                                e.job.error = None;
                            }
                            answered.push(id.clone());
                        }
                        st.mark(&id);
                    }
                    _ => {}
                }
            }
        }
        if !answered.is_empty() {
            self.env.emit_conflict_done(answered);
        }
        self.kick();
    }

    pub fn resume(self: &Arc<Self>, ids: &[String]) {
        {
            let mut st = self.lock();
            for id in ids {
                if let Some(b) = st.batches.get_mut(id) {
                    b.paused = false;
                }
            }
            for id in st.expand(ids) {
                let Some(e) = st.jobs.get_mut(&id) else { continue };
                match e.job.status {
                    TransferStatus::Paused => {
                        e.job.status = TransferStatus::Queued;
                        st.enqueue(&id, false);
                        st.mark(&id);
                    }
                    TransferStatus::Running
                        if e.ctrl.as_ref().is_some_and(|c| c.stop.load(Ordering::SeqCst) == STOP_PAUSE) =>
                    {
                        e.resume_after_stop = true;
                    }
                    _ => {}
                }
            }
        }
        self.schedule();
    }

    pub fn cancel(self: &Arc<Self>, ids: &[String]) {
        let mut cleanup = Vec::new();
        let mut answered = Vec::new();
        {
            let mut st = self.lock();
            for id in ids {
                if let Some(b) = st.batches.get_mut(id) {
                    b.canceled = true;
                }
            }
            let now = now_ms();
            for id in st.expand(ids) {
                let Some(e) = st.jobs.get_mut(&id) else { continue };
                match e.job.status {
                    TransferStatus::Running => {
                        e.resume_after_stop = false;
                        if let Some(c) = &e.ctrl {
                            c.stop_with(STOP_CANCEL);
                        }
                    }
                    TransferStatus::Queued | TransferStatus::Paused | TransferStatus::Error => {
                        if e.touched && matches!(e.kind, Kind::File { .. }) {
                            cleanup.push(e.job.clone());
                        }
                        e.job.status = TransferStatus::Canceled;
                        e.job.speed = 0.0;
                        e.job.finished_at = Some(now);
                        if st.questions.remove(&id).is_some() {
                            if let Some(e) = st.jobs.get_mut(&id) {
                                e.job.error = None;
                            }
                            answered.push(id.clone());
                        }
                        st.mark(&id);
                    }
                    _ => {}
                }
            }
        }
        if !answered.is_empty() {
            self.env.emit_conflict_done(answered);
        }
        for job in cleanup {
            let me = self.clone();
            tokio::spawn(async move { me.delete_partial(&job).await });
        }
        self.kick();
    }

    pub fn retry(self: &Arc<Self>, ids: &[String]) {
        let mut walks = Vec::new();
        let mut removed = Vec::new();
        {
            let mut st = self.lock();
            for id in ids {
                if let Some(b) = st.batches.get_mut(id) {
                    b.canceled = false;
                }
            }
            for id in st.expand(ids) {
                let Some(e) = st.jobs.get_mut(&id) else { continue };
                if e.job.status != TransferStatus::Error {
                    continue;
                }
                match e.kind.clone() {
                    Kind::File { .. } | Kind::Link { .. } => {
                        e.job.status = TransferStatus::Queued;
                        e.job.error = None;
                        e.job.finished_at = None;
                        st.enqueue(&id, false);
                        st.mark(&id);
                    }
                    Kind::Walk(spec) => {
                        let batch = e.job.batch_id.clone();
                        let session = e.job.session_id.clone();
                        st.jobs.remove(&id);
                        st.order.retain(|x| x != &id);
                        if let Some(b) = st.batches.get_mut(&batch) {
                            b.jobs.retain(|x| x != &id);
                            b.walkers += 1;
                        }
                        removed.push(id.clone());
                        walks.push((batch, session, spec));
                    }
                    Kind::Info => {}
                }
            }
        }
        if !removed.is_empty() {
            self.env.emit_removed(removed);
        }
        for (batch, session, spec) in walks {
            let me = self.clone();
            tokio::spawn(async move {
                match spec {
                    WalkSpec::UploadRoot { local, remote_dir } => {
                        me.walk_upload_root(&batch, &session, local, &remote_dir).await
                    }
                    WalkSpec::DownloadRoot { remote, local_dir } => {
                        me.walk_download_root(&batch, &session, remote, &local_dir).await
                    }
                    WalkSpec::DownloadDir { remote, local, rel } => {
                        me.walk_download_tree(&batch, &session, remote, local, rel).await
                    }
                }
                me.walker_done(&batch);
            });
        }
        self.schedule();
    }
}
