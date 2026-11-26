// Análisis de vulnerabilidades: ejecuta las fases en el servidor (PENDIENTES 10.7) y le pasa las salidas
// al motor, que consulta OSV, junta las fuentes y guarda el historial.
//
// - Fases 1 a 3 sin elevar (las herramientas de la distro funcionan sin root).
// - Fase 4 (imágenes): sin sudo, las del usuario conectado; con sudo, las de root y las de los usuarios
//   elegidos (se entra como cada uno desde el script del motor).
// - Cada fase lleva su `execId`: «Cancelar» detiene el proceso en el servidor y corta OSV.
// - Si una fase falla se anota y se sigue: un informe parcial es mejor que ninguno.
// El estado está en scanState.ts; la ejecución de cada fase, en scanExec.ts; la fase 4, en scanImages.ts.
import { errorMessage, isApiError } from "../../api/core";
import { newExecId, snippets } from "../../api/snippets";
import { vulnscan, type Report, type ScanInput, type ScanNote, type ScanPlan, type VulnScanSettings } from "../../api/vulnscan";
import type { Elevation } from "../privileges";
import { Canceled, EMPTY, exec, live, raw } from "./scanExec";
import { imageContexts, scanImages } from "./scanImages";
import { PHASES, patchRun, setPhase, setProgress, useVulnScan } from "./scanState";

export * from "./scanState";

export interface ScanOptions {
  sessionId: string;
  profileId: string;
  /** Elevación disponible (null = sin sudo). */
  elevation: Elevation | null;
  settings: VulnScanSettings;
}

/** ¿Hay un análisis en curso en esa sesión? */
export function isScanning(sessionId: string): boolean {
  return useVulnScan.getState().runs[sessionId]?.running ?? false;
}

/** Cancela el análisis de la sesión: detiene el comando del servidor y las peticiones a OSV. */
export async function cancelScan(sessionId: string): Promise<void> {
  const l = live.get(sessionId);
  if (!l) return;
  l.canceled = true;
  setProgress(sessionId, "Cancelando…");
  await Promise.allSettled([l.execId ? snippets.cancelExec(l.execId) : Promise.resolve(false), vulnscan.cancel(l.scanId)]);
}

/** Analiza el servidor. Devuelve el informe (ya guardado en el historial) o null si se canceló o falló. */
export async function startScan(o: ScanOptions): Promise<Report | null> {
  const { sessionId, settings } = o;
  if (isScanning(sessionId)) return null;
  const scanId = newExecId();
  live.set(sessionId, { scanId, execId: null, canceled: false });
  useVulnScan.setState((s) => ({
    runs: {
      ...s.runs,
      [sessionId]: {
        scanId,
        running: true,
        phases: PHASES.map((p) => ({ ...p, status: "pending", detail: null })),
        progress: "Empezando…",
        error: null,
        canceled: false,
        startedAt: Date.now(),
      },
    },
  }));
  const none: Elevation = { kind: "none" };
  const notes: ScanNote[] = [];
  const started = Date.now();
  const input: ScanInput = {
    serverId: o.profileId,
    detect: EMPTY,
    inventory: EMPTY,
    distroTool: null,
    distroOutput: null,
    images: [],
    elevated: false,
    useOsv: settings.useOsv,
    notes,
    serverMs: 0,
  };
  const unlisten = await vulnscan.onProgress((p) => {
    if (p.scanId !== scanId) return;
    setProgress(sessionId, p.text);
    if (p.phase === "osv" && p.total > 0) setPhase(sessionId, "osv", "running", `${p.done} de ${p.total}`);
  });

  try {
    // ── 1. Detectar ──
    setPhase(sessionId, "detect", "running");
    setProgress(sessionId, "Detectando el sistema…");
    const det = await exec(sessionId, { kind: "detect" }, none, 20);
    input.detect = raw(det);
    const plan: ScanPlan = await vulnscan.plan(det.stdout);
    if (!plan.complete) {
      setPhase(sessionId, "detect", "warn", "Salida incompleta");
    } else {
      setPhase(sessionId, "detect", "ok", plan.os || null);
    }

    // ── 2. Inventario ──
    setPhase(sessionId, "inventory", "running");
    setProgress(sessionId, "Leyendo paquetes y programas…");
    try {
      const inv = await exec(sessionId, { kind: "inventory" }, none, 60);
      input.inventory = raw(inv);
      setPhase(sessionId, "inventory", inv.timedOut ? "warn" : "ok", inv.timedOut ? "Tardó demasiado" : null);
    } catch (e) {
      if (e instanceof Canceled) throw e;
      notes.push({ phase: "inventory", level: "error", text: `Inventario: ${errorMessage(e)}` });
      setPhase(sessionId, "inventory", "error", errorMessage(e));
    }

    // ── 3. Herramienta de la distro ──
    if (!plan.distroTool) {
      setPhase(sessionId, "distro", "skipped", "No hay ninguna instalada en el servidor");
    } else if (!settings.useDistroTool) {
      setPhase(sessionId, "distro", "skipped", "Desactivada en las opciones");
    } else {
      setPhase(sessionId, "distro", "running", "La primera vez baja sus datos y puede tardar 1–2 minutos");
      setProgress(sessionId, `Ejecutando ${plan.distroTool} en el servidor…`);
      try {
        const d = await exec(sessionId, { kind: "distro", tool: plan.distroTool, codename: plan.codename || null }, none, 300);
        input.distroTool = plan.distroTool;
        input.distroOutput = raw(d);
        setPhase(sessionId, "distro", d.timedOut ? "warn" : "ok", d.timedOut ? "Tardó demasiado" : null);
      } catch (e) {
        if (e instanceof Canceled) throw e;
        notes.push({ phase: "distro", level: "warn", text: `${plan.distroTool}: ${errorMessage(e)}` });
        setPhase(sessionId, "distro", "warn", errorMessage(e));
      }
    }

    // ── 4. Contenedores e imágenes ──
    input.elevated = plan.isRoot;
    if (!settings.scanImages) {
      setPhase(sessionId, "images", "skipped", "Desactivado en las opciones");
    } else {
      setPhase(sessionId, "images", "running");
      const ctxs = await imageContexts(o, plan, notes);
      input.elevated = plan.isRoot || ctxs.some((c) => c.el.kind !== "none");
      if (!ctxs.length) {
        setPhase(sessionId, "images", "skipped", "No hay Podman ni Docker accesibles");
      } else {
        const res = await scanImages(sessionId, ctxs, plan, settings, input.images, notes);
        setPhase(sessionId, "images", res.failed ? "warn" : "ok", res.text);
      }
    }

    // ── 5 y 6. OSV y juntar (motor) ──
    if (live.get(sessionId)?.canceled) throw new Canceled();
    setPhase(sessionId, "osv", settings.useOsv ? "running" : "skipped", settings.useOsv ? null : "Desactivado: solo herramientas del servidor");
    setProgress(sessionId, "Consultando OSV.dev y juntando resultados…");
    input.serverMs = Date.now() - started;
    let report: Report;
    try {
      report = await vulnscan.analyze(input, scanId);
    } catch (e) {
      if (isApiError(e, "Canceled") || live.get(sessionId)?.canceled) throw new Canceled();
      throw e;
    }
    if (settings.useOsv) {
      const osv = report.sources.find((s) => s.id === "osv");
      setPhase(sessionId, "osv", osv?.used ? "ok" : "warn", osv?.used ? null : (osv?.note ?? null));
    }
    useVulnScan.getState().setReport(sessionId, report);
    patchRun(sessionId, (r) => ({ ...r, running: false, progress: "Terminado" }));
    return report;
  } catch (e) {
    const canceled = e instanceof Canceled;
    patchRun(sessionId, (r) => ({
      ...r,
      running: false,
      canceled,
      error: canceled ? null : errorMessage(e),
      progress: canceled ? "Cancelado" : "Error",
      phases: r.phases.map((p) => (p.status === "running" ? { ...p, status: canceled ? "skipped" : "error" } : p)),
    }));
    return null;
  } finally {
    unlisten();
    live.delete(sessionId);
  }
}
