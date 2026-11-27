//! Subir una lista de archivos ya decidida (destino exacto, sin recorrer carpetas) y consultar
//! cómo van. Lo usa «Sincronizar carpeta» para subir lo que se guarda en el PC.

use std::path::PathBuf;
use std::sync::Arc;

use super::super::policy::Conflict;
use super::state::{Kind, NewJob};
use super::Engine;
use crate::types::{TransferDirection, TransferStatus};

/// Un archivo a subir: origen local, ruta remota final y nombre a mostrar.
#[derive(Debug, Clone)]
pub struct UploadItem {
    pub local: PathBuf,
    pub remote: String,
    pub name: String,
    pub size: u64,
}

impl Engine {
    /// Un lote con estos archivos (las carpetas remotas que falten se crean al subir).
    /// Devuelve el id del lote y el de cada trabajo, en el mismo orden que `items`.
    pub fn upload_files(self: &Arc<Self>, session_id: &str, items: Vec<UploadItem>, policy: Conflict) -> (String, Vec<String>) {
        let batch_id = uuid::Uuid::new_v4().to_string();
        self.open_batch(&batch_id, policy);
        let jobs: Vec<NewJob> = items
            .into_iter()
            .map(|it| NewJob {
                job: Self::make_job(&batch_id, session_id, TransferDirection::Upload, &it.local, &it.remote, it.name, it.size),
                kind: Kind::File { mode: None, mtime: None },
            })
            .collect();
        let ids = jobs.iter().map(|j| j.job.id.clone()).collect();
        self.add_jobs(&batch_id, jobs);
        self.walker_done(&batch_id);
        (batch_id, ids)
    }

    /// Estado y error de cada trabajo (`None` si ya no está en la lista).
    pub fn job_states(&self, ids: &[String]) -> Vec<Option<(TransferStatus, Option<String>)>> {
        let st = self.lock();
        ids.iter()
            .map(|id| st.jobs.get(id).map(|e| (e.job.status, e.job.error.clone())))
            .collect()
    }
}
