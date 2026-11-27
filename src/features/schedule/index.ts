// Administración → Tareas programadas: cron (crontab de cada usuario, /etc/crontab, /etc/cron.d y las
// carpetas cron.daily…) y timers de systemd; horarios en palabras y cambios de una línea sin perder las
// demás. Sin React.
export * from "./cronExpr";
export * from "./crontab";
export * from "./timers";
export * from "./read";

/** Tipo de tarea de los cambios de Tareas programadas (para volver a leer al terminar). */
export const SCHEDULE_JOB = "schedule";
