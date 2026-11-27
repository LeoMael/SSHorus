// Administración → Servicios: lista de servicios del sistema (systemd u OpenRC) y `--user` de cada
// usuario, su registro y los cambios (arrancar, parar, reiniciar, activar al encender…). Sin React.
export * from "./parse";
export * from "./script";
export * from "./actions";
export * from "./read";

/** Tipo de tarea de los cambios de Servicios (para volver a leer al terminar). */
export const SERVICES_JOB = "services";
