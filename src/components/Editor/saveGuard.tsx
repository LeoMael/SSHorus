// Antes de guardar: si el archivo cambió desde que se abrió o ya no existe, preguntar.
// Lo usan el editor y la vista de comparar archivos (la misma confirmación en los dos).
import { formatDate } from "../../lib/format";
import { confirmDialog } from "../ui/dialogs";
import type { EditorIo } from "./editorIo";

/**
 * true si se puede escribir. `knownModified` es la fecha que tenía al abrirlo; `wasMissing`, que ya no
 * existía al abrirlo (entonces guardar lo crea, sin hablar de «alguien lo borró»).
 */
export async function confirmSave(io: EditorIo, knownModified: number | null, wasMissing = false): Promise<boolean> {
  const st = await io.remoteState();
  if (st.exists) {
    if (knownModified === null || st.modified === null || st.modified === knownModified) return true;
    return confirmDialog({
      title: "El archivo cambió en el servidor",
      message: (
        <>
          El archivo cambió en el servidor ({formatDate(st.modified)}) desde que lo abriste. ¿Sobrescribir con tu versión?
        </>
      ),
      confirmText: "Sobrescribir",
      danger: true,
    });
  }
  if (wasMissing) {
    return confirmDialog({
      title: "Crear el archivo",
      message: "El archivo no existe. ¿Crearlo con este contenido?",
      confirmText: "Crear y guardar",
    });
  }
  return confirmDialog({
    title: "El archivo ya no existe",
    message: "Alguien lo borró o movió en el servidor. ¿Crearlo de nuevo con tu versión?",
    confirmText: "Crear y guardar",
  });
}
