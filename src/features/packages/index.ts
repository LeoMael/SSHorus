// Administración → Paquetes: actualizaciones pendientes (y cuáles son de seguridad), buscar, instalar y
// quitar con dnf, yum, apt, zypper o apk. Sin React.
export * from "./parse";
export * from "./search";
export * from "./managers";
export * from "./changes";
export * from "./read";

/** Tipo de tarea de los cambios de Paquetes (para volver a leer al terminar). */
export const PACKAGES_JOB = "packages";
