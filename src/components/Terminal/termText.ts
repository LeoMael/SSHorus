// Texto que sale de la terminal (copiar) y que entra (pegar). Funciones puras, con pruebas en
// termText.test.ts.

/** Texto copiado sin los espacios de relleno: xterm.js copia los espacios que el programa escribió
 *  para borrar la línea (Claude Code y otros los ponen hasta el borde), y no sirven a nadie. */
export function cleanCopiedText(text: string): string {
  return text.replace(/[ \t\u00A0]+(?=\r?\n|$)/g, "").replace(/(?:\r?\n)+$/, "");
}

/** Líneas del texto pegado (sin contar el salto final). */
export function pastedLines(text: string): string[] {
  const body = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  return body ? body.split("\n") : [];
}

/** ¿Avisar antes de pegar? Solo si son varias líneas y el programa no pidió «pegado entre corchetes»:
 *  sin él, la shell ejecutaría cada línea al llegar. Con él (bash, zsh y los asistentes de IA
 *  modernos) recibe el bloque entero y no ejecuta nada solo. */
export function pasteNeedsConfirm(text: string, bracketedPaste: boolean): boolean {
  return !bracketedPaste && pastedLines(text).length > 1;
}

/** Primeras líneas para el aviso, cada una recortada. */
export function pastePreview(text: string, maxLines = 6, maxChars = 120): string {
  const lines = pastedLines(text);
  const shown = lines.slice(0, maxLines).map((l) => (l.length > maxChars ? `${l.slice(0, maxChars)}…` : l));
  if (lines.length > maxLines) shown.push(`… y ${lines.length - maxLines} líneas más`);
  return shown.join("\n");
}

/** Ctrl+C (sin más teclas): copia si hay selección; si no, va al programa (interrumpir). */
export function isPlainCtrlC(ev: Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "code">): boolean {
  return ev.ctrlKey && !ev.shiftKey && !ev.altKey && !ev.metaKey && ev.code === "KeyC";
}
