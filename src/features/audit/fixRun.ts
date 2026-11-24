// Aplicar el arreglo de una comprobación: como root con la elevación de Administración (la contraseña de
// sudo guardada viaja por stdin, nunca en el comando), cancelable y apuntado en el historial de cambios.
import { errorMessage, isApiError } from "../../api/core";
import type { AuditReport, Check } from "../../api/audit";
import { newExecId } from "../../api/snippets";
import { useProfiles } from "../../stores/profiles";
import { innerScript, useAdminHistory } from "../admin";
import type { Elevation } from "../privileges";
import { GUARD_SCRIPT, NO_RECHECK, parseGuard, type GuardInfo } from "./fixSafety";
import { recheckAudit, useAuditRun, type RecheckResult } from "./run";
import { ElevationError, failureText, runScript, succeeded } from "../privileges";

/** Las actualizaciones pueden tardar mucho. */
const FIX_TIMEOUT_SECS = 900;

export interface FixResult {
  ok: boolean;
  canceled: boolean;
  /** Salida (o error) del comando, recortada. */
  output: string;
  /** sudo pidió (otra vez) la contraseña. */
  needSudo: boolean;
}

function clip(s: string): string {
  return s.length > 4000 ? `…${s.slice(-4000)}` : s;
}

export async function runFix(o: {
  sessionId: string;
  profileId: string;
  serverName: string;
  check: Check;
  elevation: Elevation;
  execId: string;
}): Promise<FixResult> {
  const fix = o.check.fix;
  if (!fix) return { ok: false, canceled: false, output: "Esta comprobación no tiene arreglo", needSudo: false };
  const action = `Auditoría: ${o.check.title}`;
  const log = (ok: boolean, result: string) =>
    useAdminHistory.getState().add(o.profileId, { server: o.serverName, action, command: fix.command, ok, result });
  try {
    const plan = { action, steps: fix.command.split("\n") };
    const r = await runScript(o.sessionId, innerScript(plan), o.elevation, "", FIX_TIMEOUT_SECS, o.execId);
    const ok = succeeded(r);
    const output = clip(ok ? [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join("\n") : `${r.stdout.trim()}\n${failureText(r)}`.trim());
    log(ok, output || "Correcto");
    return { ok, canceled: false, output, needSudo: false };
  } catch (e) {
    if (isApiError(e, "Canceled")) {
      log(false, "Cancelado");
      return { ok: false, canceled: true, output: "Cancelado: puede haber quedado a medias", needSudo: false };
    }
    const msg = errorMessage(e);
    log(false, msg);
    const needSudo = e instanceof ElevationError && (e.failure === "bad-password" || e.failure === "need-password");
    return { ok: false, canceled: false, output: msg, needSudo };
  }
}

/** Lectura previa (sin sudo) para los arreglos que pueden dejarte fuera. */
export async function readGuard(sessionId: string, profileId: string): Promise<GuardInfo> {
  const r = await runScript(sessionId, GUARD_SCRIPT, { kind: "none" }, "", 15);
  const auth = useProfiles.getState().servers.find((s) => s.id === profileId)?.auth ?? null;
  return parseGuard(r.stdout, auth);
}

export interface FixBatch {
  sessionId: string;
  profileId: string;
  serverName: string;
  elevation: Elevation;
  report: AuditReport;
  checks: Check[];
  /** Id de la ejecución en curso (para cancelarla) o null. */
  onExec: (execId: string | null) => void;
  /** Se pidió «Cancelar»: no se empieza el siguiente. */
  canceled: () => boolean;
  onResult: (checkId: string, r: FixResult) => void;
}

export interface FixBatchResult {
  recheck: RecheckResult | null;
  /** No se pudo volver a comprobar (o no tiene sentido, p. ej. tras reiniciar). */
  recheckError: string | null;
}

/**
 * Aplica los arreglos uno tras otro y después vuelve a comprobar lo tocado (una sola vez), guardando el
 * informe actualizado. Para si sudo pide la contraseña o si se cancela.
 */
export async function fixAndRecheck(o: FixBatch): Promise<FixBatchResult> {
  const ran: Check[] = [];
  const run = useAuditRun.getState();
  try {
    for (const check of o.checks) {
      if (o.canceled()) break;
      run.set(o.sessionId, `Arreglando: ${check.title}…`);
      const execId = newExecId();
      o.onExec(execId);
      const r = await runFix({ ...o, check, execId });
      o.onExec(null);
      o.onResult(check.id, r);
      ran.push(check);
      if (r.needSudo || r.canceled) break;
    }
  } finally {
    run.set(o.sessionId, null);
  }
  if (!ran.length) return { recheck: null, recheckError: null };
  if (ran.some((c) => NO_RECHECK.has(c.id))) return { recheck: null, recheckError: "El servidor se reinicia: vuelve a auditar cuando arranque." };
  try {
    const recheck = await recheckAudit({ sessionId: o.sessionId, profileId: o.profileId, elevation: o.elevation, report: o.report, fixed: ran });
    return { recheck, recheckError: null };
  } catch (e) {
    return { recheck: null, recheckError: `No se pudo volver a comprobar: ${errorMessage(e)}` };
  }
}
