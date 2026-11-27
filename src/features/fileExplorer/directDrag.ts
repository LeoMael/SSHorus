// «Arrastre directo (experimental)», Ajustes → Transferencias: al arrastrar al Explorador de Windows,
// ofrecer archivos virtuales que se leen por SFTP al soltar en vez de descargar primero a la caché.
// Apagado por defecto. Solo Windows (en macOS y Linux no se ofrece). Se guarda en este equipo.
import { create } from "zustand";
import { isWindows } from "../../lib/platform";

const KEY = "sshorus.dragOut.direct.v1";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export const useDirectDrag = create<{ on: boolean }>(() => ({ on: read() }));

/** ¿Se ofrece el ajuste en este sistema? */
export const directDragAvailable = isWindows;

/** ¿Hay que intentar el arrastre directo? */
export function directDragOn(): boolean {
  return directDragAvailable && useDirectDrag.getState().on;
}

export function setDirectDrag(on: boolean): void {
  useDirectDrag.setState({ on });
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Sin almacenamiento: queda solo para esta sesión.
  }
}
