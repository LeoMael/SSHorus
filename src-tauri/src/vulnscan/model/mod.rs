//! Tipos del escáner: lo que llega del servidor, el inventario y el informe final.
//!
//! El informe (`Report`) es lo que se guarda en el historial, se exporta y ve la interfaz
//! (`src/api/vulnscan.ts` tiene los mismos tipos en TypeScript).
//!
//! Por temas: `input` (salidas en bruto e inventario), `finding` (gravedad, objetivos, hallazgos y
//! avisos) y `report` (servidor, informe e historial). Todo se re-exporta aquí.

mod finding;
mod input;
mod report;

pub use finding::*;
pub use input::*;
pub use report::*;
