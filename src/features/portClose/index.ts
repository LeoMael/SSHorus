// «Cerrar puerto» (Administración → Puertos y el mapa): quién abre el puerto, qué formas de cerrarlo
// funcionan de verdad (cortafuegos, servicio, programa o contenedor) y aplicarlas como tarea.
// La interfaz está en components/PortClose/.
export type * from "./types";
export { findOpener, isSshPort, portOfMapNode } from "./opener";
export { closeOptions, portTitle, type CloseInput } from "./options";
export { containerStopStep, killStep, localPublish, mappingFor, unitStep } from "./commands";
export { needsElevation, PORT_CLOSE_JOB, readCloseContext, startClose, type CloseContext, type CloseRequest } from "./job";
