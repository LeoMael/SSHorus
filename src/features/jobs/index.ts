// Tareas en segundo plano de toda la app: estado (puro), ejecución, salida en vivo y comandos que se
// pueden cancelar en el servidor. La interfaz está en components/Jobs y el store en stores/jobs.ts.
export * from "../../stores/jobsState";
export * from "./output";
export * from "./run";
export * from "./remote";
export { goToJob, useJobNav } from "./nav";
