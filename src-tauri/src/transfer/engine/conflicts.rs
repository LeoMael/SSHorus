//! Preguntas de conflicto pendientes y sus respuestas.

use std::sync::Arc;

use super::super::policy::{Conflict, ConflictQuestion};
use super::Engine;
use crate::types::TransferStatus;

impl Engine {
    /// Preguntas de conflicto pendientes (en orden de llegada de los trabajos).
    pub fn conflicts(&self) -> Vec<ConflictQuestion> {
        let st = self.lock();
        st.order.iter().filter_map(|id| st.questions.get(id)).cloned().collect()
    }

    /// Responde la pregunta de `job_id` con `answer` (Overwrite / Skip / Rename / Newer).
    /// Con `apply_to_all`, la respuesta pasa a ser la política del lote: responde también
    /// sus otras preguntas pendientes y las que vendrían después.
    /// Devuelve los ids de las preguntas respondidas (ya emitidos como resueltos).
    pub fn resolve(self: &Arc<Self>, job_id: &str, answer: Conflict, apply_to_all: bool) -> Vec<String> {
        if answer == Conflict::Ask {
            return Vec::new();
        }
        let answered: Vec<String> = {
            let mut st = self.lock();
            let batch_id = match st.questions.get(job_id) {
                Some(q) => q.batch_id.clone(),
                None => match st.jobs.get(job_id) {
                    Some(e) if apply_to_all => e.job.batch_id.clone(),
                    _ => return Vec::new(),
                },
            };
            let targets: Vec<String> = if apply_to_all {
                if let Some(b) = st.batches.get_mut(&batch_id) {
                    b.policy = answer;
                }
                st.order
                    .iter()
                    .filter(|id| st.questions.get(*id).is_some_and(|q| q.batch_id == batch_id))
                    .cloned()
                    .collect()
            } else {
                vec![job_id.to_string()]
            };
            let mut done = Vec::with_capacity(targets.len());
            for id in targets {
                if st.questions.remove(&id).is_none() {
                    continue;
                }
                if let Some(e) = st.jobs.get_mut(&id)
                    && e.job.status == TransferStatus::Queued
                    && e.ctrl.is_none()
                {
                    e.decision = Some(answer);
                    e.job.error = None;
                    // Al frente: el usuario espera ver el resultado de su respuesta.
                    st.enqueue(&id, true);
                    st.mark(&id);
                }
                done.push(id);
            }
            done
        };
        if !answered.is_empty() {
            self.env.emit_conflict_done(answered.clone());
        }
        self.schedule();
        answered
    }
}
