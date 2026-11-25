//! Quién pide conectarse: lo mismo venga del puente (`POST /pair`) o de OAuth (`/authorize`). Con esto se
//! muestra el diálogo, se anota en el registro y se crea su ficha en la lista de asistentes.

use super::super::bridge::wire::{self, PairRequest};
use super::model::{Fact, Via};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Applicant {
    /// Id en la lista («claude», «claude-code-http»…): uno por asistente.
    pub client_id: String,
    /// Nombre para mostrar.
    pub name: String,
    pub via: Via,
    /// Lo que se guarda como «programa» en su ficha.
    pub program: String,
    pub pid: Option<u32>,
    pub cwd: Option<String>,
    /// Lo que ve el diálogo, en orden.
    pub facts: Vec<Fact>,
}

/// Recorta un texto que llega de fuera.
pub fn clip(s: &str, n: usize) -> String {
    s.trim().chars().take(n).collect()
}

impl Applicant {
    /// Con un id válido y el nombre recortado (sin nombre, el id). None si el id no sirve.
    pub fn new(raw_id: &str, name: &str, via: Via) -> Option<Self> {
        let client_id = wire::clean_client_id(raw_id)?;
        let name = Some(clip(name, 60)).filter(|n| !n.is_empty()).unwrap_or_else(|| client_id.clone());
        Some(Applicant { client_id, name, via, program: String::new(), pid: None, cwd: None, facts: Vec::new() })
    }

    /// Lo que llega del puente, recortado.
    pub fn from_bridge(req: &PairRequest) -> Option<Self> {
        let mut a = Applicant::new(&req.client_id, &req.name, Via::Bridge)?;
        a.program = clip(&req.program, 200);
        a.pid = req.pid;
        a.cwd = req.cwd.as_deref().map(|c| clip(c, 300)).filter(|c| !c.is_empty());
        a.facts = vec![
            Fact::new("Programa", a.program.clone()),
            Fact::new("PID", a.pid.map(|p| p.to_string()).unwrap_or_default()),
            Fact::new("Carpeta", a.cwd.clone().unwrap_or_default()),
        ];
        Some(a)
    }

    /// Resumen para el registro: «Programa: claude · PID: 42 · …».
    pub fn detail(&self) -> String {
        self.facts.iter().map(|f| format!("{}: {}", f.label, f.value)).collect::<Vec<_>>().join(" · ")
    }
}
