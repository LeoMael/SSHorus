// Ejecuta una auditoría: el script propio, Puertos y Sitios web (los de Administración) con la elevación
// disponible, y el último informe del escáner. No instala ni cambia nada. Guarda el informe en el historial.
// También vuelve a comprobar lo arreglado y guarda el informe actualizado (así no reaparece al abrirlo).
import { create } from "zustand";
import { audit, type AuditReport, type Check } from "../../api/audit";
import { vulnscan } from "../../api/vulnscan";
import { parsePorts, parseWeb, PORTS_SCRIPT, WEB_SCRIPT, type PortsResult, type WebResult } from "../admin";
import { refreshPrivilege, sudoRejected, type Elevation, readElevated, type ElevationError } from "../privileges";
import { runChecks, type AuditInput } from "./checks";
import { mergeRecheck, recheckCategories, recheckOutcome, type RecheckOutcome } from "./recheck";
import { AUDIT_SCRIPT } from "./script";
import { scoreChecks } from "./score";
import { readUserContainers, type UserContainersRead } from "./userContainers";

interface AuditRunState {
  /** Paso en curso por sesión (no está = no se audita). */
  running: Record<string, string>;
  set: (sessionId: string, step: string | null) => void;
}

export const useAuditRun = create<AuditRunState>((set) => ({
  running: {},
  set: (sessionId, step) =>
    set((s) => {
      const running = { ...s.running };
      if (step === null) delete running[sessionId];
      else running[sessionId] = step;
      return { running };
    }),
}));

function onElevationError(sessionId: string, e: ElevationError | null) {
  if (e?.failure === "need-password") refreshPrivilege(sessionId);
  if (e?.failure === "bad-password") sudoRejected(sessionId);
}

export interface AuditOptions {
  sessionId: string;
  /** Id del servidor guardado (historial). */
  profileId: string;
  /** null = sin sudo. */
  elevation: Elevation | null;
  onStep?: (text: string) => void;
}

interface CollectOptions {
  sessionId: string;
  profileId: string;
  elevation: Elevation | null;
  ports: boolean;
  web: boolean;
  /** Contenedores sin root de cada usuario (con sudo). */
  users: boolean;
  step: (text: string) => void;
}

/** Lee el servidor (solo lectura) y devuelve lo que necesitan las comprobaciones. */
async function collect(o: CollectOptions): Promise<AuditInput> {
  o.step("Revisando SSH, usuarios y el sistema…");
  const main = await readElevated(o.sessionId, AUDIT_SCRIPT, o.elevation, 180);
  onElevationError(o.sessionId, main.elevationError);
  // Si sudo falló, el resto se lee sin elevar (no se vuelve a probar la contraseña).
  const el = main.elevated ? o.elevation : null;
  let ports: PortsResult | null = null;
  if (o.ports) {
    o.step("Revisando puertos…");
    ports = await readElevated(o.sessionId, PORTS_SCRIPT, el, 30)
      .then((r) => parsePorts(r.result.stdout))
      .catch(() => null);
  }
  let web: WebResult | null = null;
  if (o.web) {
    o.step("Revisando sitios web…");
    web = await readElevated(o.sessionId, WEB_SCRIPT, el, 60)
      .then((r) => parseWeb(r.result.stdout))
      .catch(() => null);
  }
  let userCtrs: UserContainersRead | null | undefined;
  if (o.users) {
    if (el) {
      o.step("Revisando contenedores de los usuarios…");
      userCtrs = await readUserContainers(o.sessionId, el);
    } else userCtrs = null;
  }
  const last = await vulnscan.latest(o.profileId).catch(() => null);
  return {
    stdout: main.result.stdout,
    elevated: main.elevated,
    ports,
    web,
    vuln: last ? { createdAt: last.createdAt, summary: last.summary } : null,
    now: Date.now(),
    userCtrs,
  };
}

function stepper(o: { sessionId: string; onStep?: (text: string) => void }) {
  return (t: string) => {
    useAuditRun.getState().set(o.sessionId, t);
    o.onStep?.(t);
  };
}

export async function runAudit(o: AuditOptions): Promise<AuditReport> {
  const started = Date.now();
  const step = stepper(o);
  try {
    const input = await collect({ ...o, ports: true, web: true, users: true, step });
    const { checks, os } = runChecks(input);
    const s = scoreChecks(checks);
    const now = input.now;
    const report: AuditReport = {
      id: `aud-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      serverId: o.profileId,
      createdAt: new Date(now).toISOString(),
      durationMs: now - started,
      elevated: input.elevated,
      os,
      score: s.score,
      grade: s.grade,
      summary: s.summary,
      categories: s.categories,
      checks,
      ai: null,
    };
    step("Guardando…");
    return await audit.save(report);
  } finally {
    useAuditRun.getState().set(o.sessionId, null);
  }
}

export interface RecheckResult {
  report: AuditReport;
  outcomes: RecheckOutcome[];
}

/**
 * Vuelve a comprobar las categorías de lo arreglado, actualiza esas comprobaciones y las notas en el
 * informe y lo guarda con el mismo id (el historial ya no enseña el problema arreglado).
 */
export async function recheckAudit(o: AuditOptions & { report: AuditReport; fixed: Check[] }): Promise<RecheckResult> {
  const step = stepper(o);
  try {
    const cats = recheckCategories(o.fixed);
    const input = await collect({ ...o, ports: cats.includes("net") || cats.includes("isolation"), web: cats.includes("web"), users: cats.includes("containers"), step: (t) => step(`Comprobando de nuevo: ${t[0].toLowerCase()}${t.slice(1)}`) });
    const fresh = runChecks(input).checks;
    const merged = mergeRecheck(o.report, fresh, cats);
    step("Guardando…");
    const saved = await audit.save(merged);
    // El resultado de cada arreglo, con lo recién leído (un «sin comprobar» se dice tal cual).
    const byId = new Map(fresh.map((c) => [c.id, c]));
    return { report: saved, outcomes: o.fixed.map((c) => recheckOutcome(c, byId.get(c.id), input.stdout)) };
  } finally {
    useAuditRun.getState().set(o.sessionId, null);
  }
}
