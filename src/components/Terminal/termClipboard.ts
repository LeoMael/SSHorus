// Portapapeles y atajos de teclado de la terminal (copiar, pegar con aviso y búsqueda).
import type { Terminal } from "@xterm/xterm";
import { clipboard } from "../../lib/clipboard";
import { toast } from "../../stores/toasts";
import { matchesShortcut } from "../../features/shortcuts/shortcuts";
import { cleanCopiedText, isPlainCtrlC } from "./termText";
import { confirmPaste } from "./pasteGuard";

/** Copia la selección sin los espacios de relleno del final de cada línea. */
export function copyTermSelection(term: Terminal, clearSelection = false) {
  const sel = cleanCopiedText(term.getSelection());
  if (!sel) return;
  clipboard.write(sel).catch((e) => toast.error("No se pudo copiar", e));
  if (clearSelection) term.clearSelection();
}

/** Pega texto avisando antes si son varias líneas y el programa las ejecutaría. */
export async function pasteCheckedToTerm(term: Terminal, text: string, isDisposed: () => boolean) {
  if (!text || isDisposed()) return;
  const ok = await confirmPaste(text, term.modes.bracketedPasteMode);
  if (!isDisposed()) {
    if (ok) term.paste(text);
    term.focus();
  }
}

export function pasteClipboardToTerm(term: Terminal, isDisposed: () => boolean) {
  clipboard
    .read()
    .then((text) => pasteCheckedToTerm(term, text, isDisposed))
    .catch((e) => toast.error("No se pudo leer el portapapeles", e));
  term.focus();
}

export function createTermKeyHandler(
  term: Terminal,
  actions: { onSearch: () => void; onCopy: (clear?: boolean) => void; onPaste: () => void },
): (ev: KeyboardEvent) => boolean {
  return (ev: KeyboardEvent): boolean => {
    if (matchesShortcut("term.find", ev)) {
      if (ev.type === "keydown") {
        ev.preventDefault();
        actions.onSearch();
      }
      return false;
    }
    // Ctrl+C con texto seleccionado copia (y quita la selección); sin selección, interrumpe.
    if (isPlainCtrlC(ev) && term.hasSelection()) {
      if (ev.type === "keydown") {
        ev.preventDefault();
        actions.onCopy(true);
      }
      return false;
    }
    const copy = matchesShortcut("term.copy", ev);
    if (copy || matchesShortcut("term.paste", ev)) {
      if (ev.type === "keydown") {
        ev.preventDefault();
        if (copy) actions.onCopy();
        else actions.onPaste();
      }
      return false;
    }
    return true;
  };
}
