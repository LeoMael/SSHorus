// «Arreglar» y «Volver a comprobar»: ejecución en el servidor (la actualización en sí va como tarea en
// segundo plano, fixJob.ts). Lo puro (grupos, comando, cruce de informes, servicios a reiniciar) está en
// fixPlan.ts, crossCheck.ts y restart.ts.
//
// Volver a comprobar = fases 1–3 del análisis otra vez (detectar, inventario y herramienta de la distro,
// sin sudo) + OSV con las versiones de AHORA; el motor cambia el sistema del informe por lo nuevo y lo
// guarda en el historial (las imágenes se quedan como estaban). Así lo arreglado desaparece de la tabla
// y no vuelve al abrir la pestaña otra vez.
import { errorMessage, isApiError } from "../../api/core";
import { newExecId } from "../../api/snippets";
import type { ExecResult } from "../../api/types";
import { vulnscan, type Report, type ScanInput, type ScanNote, type VulnScanSettings } from "../../api/vulnscan";
import type { Elevation } from "../privileges";
import { parseRestart, restartCommand, RESTART_CHECK_SCRIPT, type RestartInfo } from "./restart";
import { runCancellable, scanScript, UpdateCancel, UpdateCanceled } from "./updateRun";

/** Límite del canal exec (el motor no deja más): una actualización grande puede no caber. */
export const FIX_TIMEOUT_SECS = 600;

function raw(r: ExecResult) {
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, timedOut: r.timedOut, truncated: r.truncated };
}

/** Qué servicios hay que reiniciar y si el servidor pide reiniciarse (como root: ven todos los procesos). */
export async function checkRestart(sessionId: string, el: Elevation, c: UpdateCancel): Promise<RestartInfo> {
  const r = await runCancellable(sessionId, RESTART_CHECK_SCRIPT, el, 90, c);
  return parseRestart(r.stdout);
}

/** Reinicia un servicio (como root). Lanza si el nombre no es seguro o el comando falla. */
export async function restartService(sessionId: string, unit: string, el: Elevation): Promise<void> {
  const cmd = restartCommand(unit);
  if (!cmd) throw new Error(`Nombre de servicio no válido: ${unit}`);
  const r = await runCancellable(sessionId, cmd, el, 120, new UpdateCancel());
  if (r.exitCode !== 0 || r.timedOut) throw new Error(r.stderr.trim() || `systemctl terminó con código ${r.exitCode ?? "?"}`);
}

/**
 * Vuelve a comprobar el sistema del informe `report` (sin sudo, como el análisis) y devuelve el informe
 * nuevo, ya guardado en el historial. Quien llama lo pone en pantalla.
 */
export async function recheckSystem(o: {
  sessionId: string;
  report: Report;
  settings: VulnScanSettings;
  cancel: UpdateCancel;
  onProgress: (text: string) => void;
}): Promise<Report> {
  const { sessionId, cancel } = o;
  const none: Elevation = { kind: "none" };
  const started = Date.now();
  const notes: ScanNote[] = [];
  o.onProgress("Detectando el sistema…");
  const det = await scanScript(sessionId, { kind: "detect" }, none, 20, cancel);
  const plan = await vulnscan.plan(det.stdout);
  o.onProgress("Leyendo los paquetes instalados…");
  const inv = await scanScript(sessionId, { kind: "inventory" }, none, 60, cancel);
  const input: ScanInput = {
    serverId: o.report.serverId,
    detect: raw(det),
    inventory: raw(inv),
    distroTool: null,
    distroOutput: null,
    images: [],
    elevated: o.report.elevated,
    useOsv: o.settings.useOsv,
    notes,
    serverMs: 0,
  };
  if (plan.distroTool && o.settings.useDistroTool) {
    o.onProgress(`Ejecutando ${plan.distroTool} en el servidor…`);
    try {
      const d = await scanScript(sessionId, { kind: "distro", tool: plan.distroTool, codename: plan.codename || null }, none, 300, cancel);
      input.distroTool = plan.distroTool;
      input.distroOutput = raw(d);
    } catch (e) {
      if (e instanceof UpdateCanceled) throw e;
      notes.push({ phase: "distro", level: "warn", text: `${plan.distroTool}: ${errorMessage(e)}` });
    }
  }
  input.serverMs = Date.now() - started;
  o.onProgress(o.settings.useOsv ? "Consultando OSV.dev…" : "Juntando resultados…");
  const scanId = newExecId();
  cancel.scanId = scanId;
  const unlisten = await vulnscan.onProgress((p) => {
    if (p.scanId === scanId) o.onProgress(p.text);
  });
  try {
    return await vulnscan.recheck(o.report.serverId, o.report.id, input, scanId);
  } catch (e) {
    if (isApiError(e, "Canceled") || cancel.canceled) throw new UpdateCanceled();
    throw e;
  } finally {
    unlisten();
    cancel.scanId = null;
  }
}
