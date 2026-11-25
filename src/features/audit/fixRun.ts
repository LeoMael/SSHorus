// Aplicar el arreglo de una comprobación: como root con la elevación de Administración (la contraseña de
// sudo guardada viaja por stdin, nunca en el comando), dentro de una tarea en segundo plano (salida en
// vivo y «Cancelar» que lo detiene también en el servidor) y apuntado en el historial de cambios.
import { errorMessage } from "../../api/core";
import type { Check } from "../../api/audit";
import { useProfiles } from "../../stores/profiles";
import { innerScript, useAdminHistory } from "../admin";
import { JobCanceled, runElevated, type JobCtx } from "../jobs";
import { ElevationError, failureText, runScript, succeeded, type Elevation } from "../privileges";
import { GUARD_SCRIPT, parseGuard, type GuardInfo } from "./fixSafety";

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

export async function runFix(
  ctx: JobCtx,
  o: {
    sessionId: string;
    profileId: string;
    serverName: string;
    check: Check;
    elevation: Elevation;
  },
): Promise<FixResult> {
  const fix = o.check.fix;
  if (!fix) return { ok: false, canceled: false, output: "Esta comprobación no tiene arreglo", needSudo: false };
  const action = `Auditoría: ${o.check.title}`;
  const log = (ok: boolean, result: string) =>
    useAdminHistory.getState().add(o.profileId, { server: o.serverName, action, command: fix.command, ok, result });
  try {
    const plan = { action, steps: fix.command.split("\n") };
    const r = await runElevated(ctx, o.sessionId, innerScript(plan), o.elevation, FIX_TIMEOUT_SECS);
    const ok = succeeded(r);
    const output = clip(ok ? [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join("\n") : `${r.stdout.trim()}\n${failureText(r)}`.trim());
    log(ok, output || "Correcto");
    return { ok, canceled: false, output, needSudo: false };
  } catch (e) {
    if (e instanceof JobCanceled) {
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
