// Lecturas y cambios de administración en el servidor. La ejecución en sí (runScript, ElevationError,
// readElevated…) es común a todas las funciones y está en features/privileges/run.ts.
import type { ExecResult } from "../../api/types";
import { splitSections } from "../../lib/remote";
import { failureText, runScript, succeeded, type Elevation } from "../privileges";
import { innerScript, readKeysScript, type Plan } from "./commands";
import { parseRead, READ_SCRIPT, type ReadResult, type ShadowEntry } from "./parse";
import { ACCOUNTS_SCRIPT, parseAccountsOutput } from "./accounts";

export async function runPlan(sessionId: string, plan: Plan, el: Elevation): Promise<ExecResult> {
  return runScript(sessionId, innerScript(plan), el, plan.secret ?? "", plan.timeoutSecs ?? 60);
}

/** Lectura como usuario normal: usuarios, grupos, shells, sesiones, herramientas. */
export async function readServer(sessionId: string): Promise<ReadResult> {
  const r = await runScript(sessionId, READ_SCRIPT, { kind: "none" }, "", 20);
  return parseRead(r.stdout);
}

/** Estado de las cuentas como root: contraseñas (/etc/shadow), caducidad, llaves autorizadas y sudo. */
export async function readShadow(sessionId: string, el: Elevation): Promise<Map<string, ShadowEntry>> {
  const r = await runScript(sessionId, ACCOUNTS_SCRIPT, el, "", 30);
  if (!succeeded(r)) throw new Error(failureText(r));
  return parseAccountsOutput(r.stdout);
}

/** Líneas de ~usuario/.ssh/authorized_keys (sin vacías). */
export async function readKeys(sessionId: string, user: string, el: Elevation): Promise<string[]> {
  const r = await runScript(sessionId, readKeysScript(user), el, "", 20);
  if (!succeeded(r)) throw new Error(failureText(r));
  const s = splitSections(r.stdout);
  if (!s.has("end")) throw new Error("No se pudo leer authorized_keys");
  return (s.get("keys") ?? []).filter((l) => l.trim() !== "");
}
