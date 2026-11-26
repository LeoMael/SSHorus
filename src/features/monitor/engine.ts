// Motor de muestreo por sesión. Cada sesión tiene un `Sampler` con «demandas» (quién quiere datos y cada
// cuánto); muestrea al ritmo de la más exigente y nunca lanza dos muestreos a la vez.
// Los resultados van al store de store.ts, que leen el panel y el resumen de conexiones.
import { snippets } from "../../api/snippets";
import { errorMessage } from "../../api/core";
import { toast } from "../../stores/toasts";
import { ElevationError, runScript } from "../privileges";
import type { Elevation } from "../privileges";
import { useTabs } from "../../stores/tabs";
import { buildSampleCommand, parseSample, SAMPLE_TIMEOUT_SECS, type RawSample, type SampleInfo } from "./sample";
import { deriveMetrics, toPoint } from "./derive";
import { evaluateAlerts, loadAlerts, onAlertsChanged, type AlertConfig } from "./alerts";
import { ContainerAttribution } from "./attribution";
import { appendHistory, nextCpuHistory, type CpuMark } from "./history";
import { ContainersPoller } from "./containersPoller";
import { emptyMonitor, useMonitorStore } from "./store";

export { emptyMonitor, useMonitorStore, useSessionMonitor, type ContainersState, type SessionMonitor } from "./store";

/** Cada cuánto se vuelve a pedir lo que casi no cambia (usuarios, nº de CPU, herramientas). */
const FULL_EVERY_MS = 5 * 60 * 1000;
/** Tras un error, no reintentar más rápido que esto. */
const ERROR_BACKOFF_MS = 5000;
/** Con sudo, como mucho una muestra cada tanto: cada `sudo` queda en el registro del servidor. */
export const ELEVATED_MIN_INTERVAL = 5000;

class Sampler {
  private demands = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private disposed = false;
  private lastStart = 0;
  private failed = false;
  private count = 0;

  private prev: RawSample | null = null;
  /** La última muestra se leyó con sudo. */
  private elevated = false;
  private info: SampleInfo | null = null;
  private lastFullAt = 0;
  private users = new Map<number, string>();
  /** pid → uid (con su arranque, para no confundir pids reutilizados). */
  private uidCache = new Map<number, { uid: number; start: number }>();
  private wantUids: number[] = [];
  private attribution = new ContainerAttribution();
  private cpuHist: CpuMark[] = [];
  private activeAlerts = new Set<string>();
  private alertCfg: AlertConfig;
  private elevation: Elevation | null = null;
  /** sudo falló con la elevación actual: no se reintenta hasta que cambie. */
  private elevationFailed = false;
  private containers: ContainersPoller;

  constructor(
    readonly sessionId: string,
    public profileId: string,
  ) {
    this.alertCfg = loadAlerts(profileId);
    this.containers = new ContainersPoller(
      sessionId,
      () => this.info,
      (list) => this.attribution.learnNames(list),
    );
  }

  reloadAlerts() {
    this.alertCfg = loadAlerts(this.profileId);
    if (!this.alertCfg.enabled && this.activeAlerts.size) {
      this.activeAlerts.clear();
      useMonitorStore.getState().patch(this.sessionId, { alerts: [] });
    }
  }

  get hasDemand() {
    return this.demands.size > 0 || this.containers.hasDemand;
  }

  setDemand(owner: string, intervalMs: number | null) {
    if (intervalMs === null) this.demands.delete(owner);
    else this.demands.set(owner, intervalMs);
    this.schedule();
  }

  /** Con qué se puede elevar (null = sin sudo). Solo se usa si /proc oculta los procesos de otros. */
  setElevation(el: Elevation | null) {
    if (el === this.elevation) return;
    this.elevation = el;
    this.elevationFailed = false;
    this.schedule();
  }

  /** Elevación para la próxima muestra (null = sin elevar). */
  private sampleElevation(): Elevation | null {
    const el = this.elevation;
    if (!el || el.kind === "none" || el.kind === "root" || this.elevationFailed || !this.info?.hidepid) return null;
    return el;
  }

  setContainersDemand(owner: string, on: boolean) {
    this.containers.setDemand(owner, on);
  }

  private interval(): number | null {
    if (!this.demands.size) return null;
    const iv = Math.min(...this.demands.values());
    return this.sampleElevation() ? Math.max(iv, ELEVATED_MIN_INTERVAL) : iv;
  }

  private schedule() {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running) return; // al terminar vuelve a llamar a schedule()
    let iv = this.interval();
    if (iv === null) return;
    // Tras la primera muestra no hay % de CPU (hace falta una diferencia): la segunda llega antes.
    if (this.count === 1) iv = Math.min(iv, 1000);
    const wait = Math.max(0, this.lastStart + (this.failed ? Math.max(iv, ERROR_BACKOFF_MS) : iv) - Date.now());
    this.timer = setTimeout(() => void this.tick(), wait);
  }

  private async tick() {
    this.timer = null;
    if (this.disposed || this.running) return;
    this.running = true;
    this.lastStart = Date.now();
    const store = useMonitorStore.getState();
    store.patch(this.sessionId, { loading: true });
    const full = !this.info || Date.now() - this.lastFullAt > FULL_EVERY_MS;
    const el = this.sampleElevation();
    try {
      const cmd = buildSampleCommand({
        full,
        uidPids: this.wantUids,
        uidAll: this.count === 0 || this.elevated !== !!el,
        extra: this.attribution.parts(),
      });
      const r = el
        ? await runScript(this.sessionId, cmd, el, "", SAMPLE_TIMEOUT_SECS)
        : await snippets.exec(this.sessionId, cmd, SAMPLE_TIMEOUT_SECS);
      if (this.disposed) return;
      this.elevated = !!el;
      const raw = parseSample(r.stdout);
      if (raw.noProc) {
        this.failed = true;
        store.patch(this.sessionId, { noProc: true, loading: false, error: null });
        return;
      }
      if (!raw.cpu || !raw.mem) {
        this.failed = true;
        const why = r.timedOut ? "El servidor tardó demasiado en responder" : r.stderr.trim().split("\n")[0] || "Respuesta incompleta";
        store.patch(this.sessionId, { loading: false, error: why });
        return;
      }
      this.failed = false;
      this.absorb(raw, full);
    } catch (e) {
      if (this.disposed) return;
      if (e instanceof ElevationError) {
        // Contraseña rechazada o sudo denegado: se sigue sin sudo (lo que se pueda ver).
        this.elevationFailed = true;
        store.patch(this.sessionId, { loading: false });
        return;
      }
      this.failed = true;
      useMonitorStore.getState().patch(this.sessionId, { loading: false, error: errorMessage(e) });
    } finally {
      this.running = false;
      this.schedule();
    }
  }

  private absorb(raw: RawSample, full: boolean) {
    if (full && raw.info) {
      // Con sudo, `id` dice root: el usuario de la conexión es el de antes.
      const me = this.elevated && this.info ? { user: this.info.user, uid: this.info.uid } : {};
      this.info = { ...raw.info, ...me };
      this.lastFullAt = Date.now();
      if (raw.users.size) this.users = raw.users;
    }
    for (const [pid, uid] of raw.uids) {
      const p = raw.procs.find((x) => x.pid === pid);
      this.uidCache.set(pid, { uid, start: p?.start ?? NaN });
    }
    this.attribution.absorb(raw);
    const hz = this.info?.hz ?? 100;
    const pageSize = this.info?.pageSize ?? 4096;
    const metrics = deriveMetrics(this.prev, raw, {
      hz,
      pageSize,
      nproc: this.info?.nproc ?? null,
      uidOf: (p) => {
        const c = this.uidCache.get(p.pid);
        return c && (c.start === p.start || Number.isNaN(c.start)) ? c.uid : null;
      },
      userOf: (uid) => this.users.get(uid) ?? null,
      containerOf: (p, uid) => this.attribution.containerOf(p, uid, (u) => this.users.get(u) ?? null),
    });
    // Limpieza de la caché de uids (procesos que ya no existen) y pids a preguntar la próxima vez.
    const alive = new Set(raw.procs.map((p) => p.pid));
    for (const pid of this.uidCache.keys()) if (!alive.has(pid)) this.uidCache.delete(pid);
    this.wantUids = metrics.procs.filter((p) => p.uid === null).map((p) => p.pid);
    this.attribution.plan(metrics.procs, !!(this.info?.docker || this.info?.podman));
    this.prev = raw;
    this.count++;

    const cur = useMonitorStore.getState().bySession[this.sessionId] ?? emptyMonitor();
    const history = appendHistory(cur.history, toPoint(metrics), raw.at);

    // CPU sostenida para la alerta (contadores del servidor, últimos 10 min).
    const cpu = nextCpuHistory(this.cpuHist, raw.uptime !== null && raw.cpu ? { uptime: raw.uptime, cpu: raw.cpu } : null);
    this.cpuHist = cpu.hist;
    const sustained = cpu.sustained;
    const alerts = evaluateAlerts(this.alertCfg, metrics, sustained, this.activeAlerts);
    const tabTitle = useTabs.getState().tabs.find((t) => t.sessionId === this.sessionId)?.title ?? "Servidor";
    for (const a of alerts) {
      if (!this.activeAlerts.has(a.key)) toast.error(`${tabTitle}: ${a.title}`, a.detail);
    }
    this.activeAlerts = new Set(alerts.map((a) => a.key));

    useMonitorStore.getState().patch(this.sessionId, {
      metrics,
      history,
      error: null,
      loading: false,
      noProc: false,
      info: this.info,
      elevated: this.elevated,
      alerts,
    });
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.demands.clear();
    this.containers.dispose();
  }
}

const samplers = new Map<string, Sampler>();
let watching = false;

function watch() {
  if (watching) return;
  watching = true;
  // Pestaña cerrada → fuera su muestreador y sus datos.
  useTabs.subscribe((s) => {
    const ids = new Set(s.tabs.map((t) => t.sessionId));
    for (const [id, sm] of samplers) {
      if (!ids.has(id)) {
        sm.dispose();
        samplers.delete(id);
        useMonitorStore.getState().drop(id);
      }
    }
  });
  onAlertsChanged((profileId) => {
    for (const sm of samplers.values()) if (sm.profileId === profileId) sm.reloadAlerts();
  });
}

function sampler(sessionId: string, profileId: string): Sampler {
  watch();
  let sm = samplers.get(sessionId);
  if (!sm) {
    sm = new Sampler(sessionId, profileId);
    samplers.set(sessionId, sm);
  } else if (sm.profileId !== profileId) {
    sm.profileId = profileId;
    sm.reloadAlerts();
  }
  return sm;
}

/**
 * Declara cada cuánto quiere datos `owner` para una sesión (null = ya no). El muestreo va al ritmo
 * de la demanda más rápida y se para cuando no queda ninguna.
 */
export function setSampleDemand(sessionId: string, profileId: string, owner: string, intervalMs: number | null): void {
  if (intervalMs === null && !samplers.has(sessionId)) return;
  sampler(sessionId, profileId).setDemand(owner, intervalMs);
}

/** Elevación disponible para el muestreo de una sesión (ver Sampler.setElevation). */
export function setSampleElevation(sessionId: string, profileId: string, el: Elevation | null): void {
  if (!el && !samplers.has(sessionId)) return;
  sampler(sessionId, profileId).setElevation(el);
}

export function setContainersDemand(sessionId: string, profileId: string, owner: string, on: boolean): void {
  if (!on && !samplers.has(sessionId)) return;
  sampler(sessionId, profileId).setContainersDemand(owner, on);
}
