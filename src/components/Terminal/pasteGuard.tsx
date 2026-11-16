// Aviso antes de pegar varias líneas en un programa que las ejecutaría una a una.
import { confirmDialog } from "../ui/dialogs";
import { pasteNeedsConfirm, pastedLines, pastePreview } from "./termText";

/** true = pegar. Pregunta solo cuando hace falta (ver `pasteNeedsConfirm`). */
export async function confirmPaste(text: string, bracketedPaste: boolean): Promise<boolean> {
  if (!pasteNeedsConfirm(text, bracketedPaste)) return true;
  const n = pastedLines(text).length;
  return confirmDialog({
    title: `¿Pegar ${n} líneas?`,
    message: (
      <div>
        <p>Este programa no protege el pegado: cada línea se ejecutará como un comando al llegar.</p>
        <pre className="term-paste-preview">{pastePreview(text)}</pre>
      </div>
    ),
    confirmText: "Pegar",
  });
}
