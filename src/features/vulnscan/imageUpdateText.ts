// Textos de «Actualizar imagen»: con qué usuario se ejecuta y el final de la salida de un comando.
import type { ExecResult } from "../../api/types";
import type { Owner } from "./imageUpdateRead";

/** Frase antes de los comandos: deja claro como quién se ejecutan. */
export function runAsText(owner: Owner, who: string): string {
  if (owner.kind === "user") return `Se ejecutará como «${who}» (SSHorus entra como ese usuario con sudo, igual que al analizar):`;
  if (owner.kind === "root") return "Se ejecutará como root:";
  return "Se ejecutará con tu usuario:";
}

/** Últimas `lines` líneas de la salida (stdout y luego stderr). */
export function outputTail(r: ExecResult | null, lines = 40): string {
  if (!r) return "";
  const text = [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join("\n");
  return text.split("\n").slice(-lines).join("\n");
}
