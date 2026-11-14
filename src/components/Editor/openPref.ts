// Preferencia «Al abrir un archivo»: dividido junto al explorador (por defecto), en una pestaña más o en ventana aparte.
// Se guarda en localStorage y no en Settings: Settings es un tipo compartido con el motor (Rust)
// y esta opción solo afecta a la interfaz (igual que gpuPref de la terminal).

export type EditorOpenMode = "tab" | "split" | "window";

/** Clave nueva: la de antes («sshorus.editor.openMode») guardaba «tab» forzado por una migración vieja. */
const KEY = "sshorus.editor.open";
const OLD_KEYS = ["sshorus.editor.openMode", "sshorus.editor.openMode.v"];
const DEFAULT_MODE: EditorOpenMode = "split";
const MODES: EditorOpenMode[] = ["tab", "split", "window"];
/** Copia en memoria por si localStorage no está disponible. */
let fallback: EditorOpenMode = DEFAULT_MODE;
let cleaned = false;

/** Borra una sola vez las claves viejas para que no queden restos. */
function cleanOldKeys(): void {
  if (cleaned) return;
  cleaned = true;
  try {
    for (const k of OLD_KEYS) localStorage.removeItem(k);
  } catch {
    /* sin almacenamiento */
  }
}

/** «split» salvo que el usuario haya elegido otra cosa. */
export function getEditorOpenMode(): EditorOpenMode {
  cleanOldKeys();
  try {
    const v = localStorage.getItem(KEY) as EditorOpenMode | null;
    return v && MODES.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function setEditorOpenMode(mode: EditorOpenMode): void {
  cleanOldKeys();
  fallback = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* sin almacenamiento: vale solo para esta sesión */
  }
}
