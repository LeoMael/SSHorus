// Motor del Panel de VPS: lee cada VPS con una sola conexión y un solo comando por ronda, pocas a la vez.
// No depende de Tauri (las llamadas se inyectan) para poder probarlo con un motor simulado.
// - Reutiliza la sesión de una pestaña abierta de ese VPS; si no, abre una propia en segundo plano.
// - Nunca pregunta nada por su cuenta: si el VPS pide contraseña, código o huella, queda en «attention»
//   hasta que el usuario pulse «Conectar».
// - Si no responde, reintenta con espera creciente (retryDelayMs).
import type { ExecResult, ServerProfile } from "../../api/types";
import { cpuPercent } from "../monitor/derive";
import type { CpuTicks } from "../monitor";
import { classifyConnectError, errText } from "../multirun/engine";
import { pickProfile, type Vps } from "./group";
import { emptyLive, pushHistory, retryDelayMs, type VpsLive } from "./health";
import { buildProbeCommand, parseProbe, PROBE_TIMEOUT_SECS, WARMUP_MS } from "./probe";

export interface PollerDeps {
  /** Sesión conectada de una pestaña de alguno de estos perfiles (se reutiliza), o null. */
  tabSession(profileIds: string[]): { profileId: string; sessionId: string } | null;
  /** Alguna pestaña de estos perfiles se está reconectando sola (mejor esperarla). */
  tabReconnecting(profileIds: string[]): boolean;
  /** Conecta sin interacción (credenciales guardadas). Lanza errores con `.kind`. */
  connect(profileId: string): Promise<string>;
  /** Conecta resolviendo diálogos. null = el usuario canceló. */
  connectInteractive(profileId: string): Promise<string | null>;
  exec(sessionId: string, command: string, timeoutSecs: number): Promise<ExecResult>;
  disconnect(sessionId: string): Promise<void>;
  now(): number;
}

/** Lecturas a la vez como máximo (conectar + leer). */
export const MAX_PARALLEL = 4;

export class FleetPoller {
  private targets = new Map<string, Vps>();
  private live = new Map<string, VpsLive>();
  private running = new Set<string>();
  private prevCpu = new Map<string, CpuTicks>();
  private sudoUsers = new Map<string, Set<string>>();
  private disposed = false;

  constructor(
    private deps: PollerDeps,
    private onChange: (live: Record<string, VpsLive>) => void,
    private intervalMs: number,
  ) {}

  /** VPS que se ven ahora. Los que desaparecen cierran su conexión propia. */
  setTargets(list: readonly Vps[]): void {
    const keys = new Set(list.map((v) => v.key));
    for (const key of [...this.targets.keys()]) if (!keys.has(key)) this.forget(key);
    for (const v of list) {
      this.targets.set(v.key, v);
      if (!this.live.has(v.key)) this.live.set(v.key, emptyLive());
    }
    this.emit();
  }

  setIntervalMs(ms: number): void {
    const now = this.deps.now();
    for (const [key, l] of this.live) {
      if (l.status === "online") this.live.set(key, { ...l, nextAt: Math.min(l.nextAt, now + ms) });
    }
    this.intervalMs = ms;
  }

  /** Lanza las lecturas que tocan, sin pasar de MAX_PARALLEL. */
  pump(): void {
    if (this.disposed) return;
    const now = this.deps.now();
    for (const key of this.targets.keys()) {
      if (this.running.size >= MAX_PARALLEL) return;
      const l = this.live.get(key);
      if (!l || this.running.has(key) || l.nextAt > now) continue;
      void this.run(key);
    }
  }

  /** Reintentar ya un VPS sin conexión (sin diálogos). */
  retryNow(key: string): void {
    this.patch(key, { nextAt: 0 });
    this.pump();
  }

  /** «Conectar»: el usuario lo pidió, así que aquí sí se muestran los diálogos. */
  async connectNow(key: string): Promise<void> {
    const v = this.targets.get(key);
    if (!v || this.running.has(key)) return;
    const profile = this.choose(v);
    if (!profile) return;
    this.running.add(key);
    this.patch(key, { status: "connecting", profileId: profile.id, message: null });
    try {
      const sid = await this.deps.connectInteractive(profile.id);
      if (!this.alive(key)) {
        if (sid) this.deps.disconnect(sid).catch(() => {});
        return;
      }
      if (sid === null) {
        this.patch(key, { status: "attention" });
        return;
      }
      this.patch(key, { status: "waiting", sessionId: sid, owned: true, attention: null, failures: 0, nextAt: 0 });
    } catch (e) {
      const f = classifyConnectError(e, profile.auth);
      this.patch(key, f.attention ? { status: "attention", attention: f.attention, message: f.message } : this.failure(key, f.message));
    } finally {
      this.running.delete(key);
      this.pump();
    }
  }

  /**
   * Para abrir el VPS en una pestaña: entrega la sesión propia (deja de ser del panel y no se cierra al
   * cerrarlo). null si no tiene una.
   */
  handOver(key: string): { profileId: string; sessionId: string } | null {
    const l = this.live.get(key);
    if (!l?.owned || !l.sessionId || !l.profileId) return null;
    this.patch(key, { owned: false });
    return { profileId: l.profileId, sessionId: l.sessionId };
  }

  /** Cierra las conexiones que abrió el panel. */
  dispose(): void {
    this.disposed = true;
    for (const key of [...this.targets.keys()]) this.forget(key);
  }

  private forget(key: string) {
    const l = this.live.get(key);
    if (l?.owned && l.sessionId) this.deps.disconnect(l.sessionId).catch(() => {});
    this.targets.delete(key);
    this.live.delete(key);
    this.prevCpu.delete(key);
  }

  private alive(key: string) {
    return !this.disposed && this.targets.has(key);
  }

  private choose(v: Vps): ServerProfile | null {
    return pickProfile(v, { withTab: new Set(), sudoUsers: this.sudoUsers.get(v.key) ?? new Set() });
  }

  private failure(key: string, message: string): Partial<VpsLive> {
    const failures = (this.live.get(key)?.failures ?? 0) + 1;
    return { status: "offline", message, failures, nextAt: this.deps.now() + retryDelayMs(failures, this.intervalMs) };
  }

  /** Sesión para leer: la de una pestaña, la propia, o una nueva (sin diálogos). null = no se lee ahora. */
  private async session(key: string, v: Vps): Promise<{ sid: string; profileId: string } | null> {
    const ids = v.profiles.map((p) => p.id);
    const l = this.live.get(key) ?? emptyLive();
    const tab = this.deps.tabSession(ids);
    if (tab) {
      // Ya hay pestaña: la conexión propia sobra.
      if (l.owned && l.sessionId && l.sessionId !== tab.sessionId) this.deps.disconnect(l.sessionId).catch(() => {});
      this.patch(key, { sessionId: tab.sessionId, profileId: tab.profileId, owned: false, attention: null });
      return { sid: tab.sessionId, profileId: tab.profileId };
    }
    if (l.owned && l.sessionId && l.profileId) return { sid: l.sessionId, profileId: l.profileId };
    if (l.status === "attention") {
      this.patch(key, { nextAt: this.deps.now() + this.intervalMs });
      return null;
    }
    if (this.deps.tabReconnecting(ids)) {
      this.patch(key, { status: "offline", sessionId: null, message: "La pestaña se está reconectando", nextAt: this.deps.now() + this.intervalMs });
      return null;
    }
    const profile = this.choose(v);
    if (!profile) return null;
    this.patch(key, { status: l.at ? l.status : "connecting", profileId: profile.id, sessionId: null, owned: false });
    try {
      const sid = await this.deps.connect(profile.id);
      if (!this.alive(key)) {
        this.deps.disconnect(sid).catch(() => {});
        return null;
      }
      this.patch(key, { sessionId: sid, owned: true });
      return { sid, profileId: profile.id };
    } catch (e) {
      if (!this.alive(key)) return null;
      const f = classifyConnectError(e, profile.auth);
      this.patch(key, f.attention ? { status: "attention", attention: f.attention, message: f.message } : this.failure(key, f.message));
      return null;
    }
  }

  private async run(key: string): Promise<void> {
    const v = this.targets.get(key);
    if (!v) return;
    this.running.add(key);
    try {
      const s = await this.session(key, v);
      if (!s || !this.alive(key)) return;
      await this.read(key, v, s.sid);
    } finally {
      this.running.delete(key);
      this.emit();
      this.pump();
    }
  }

  private async read(key: string, v: Vps, sid: string): Promise<void> {
    const warmup = !this.prevCpu.has(key);
    const cmd = buildProbeCommand({ users: v.profiles.map((p) => p.username), warmup });
    const t0 = this.deps.now();
    let r: ExecResult;
    try {
      r = await this.deps.exec(sid, cmd, PROBE_TIMEOUT_SECS);
    } catch (e) {
      if (!this.alive(key)) return;
      const l = this.live.get(key);
      // La sesión propia ya no sirve: la próxima vez se abre otra.
      if (l?.owned && l.sessionId === sid) this.deps.disconnect(sid).catch(() => {});
      this.patch(key, { ...this.failure(key, errText(e)), sessionId: null, owned: false });
      return;
    }
    if (!this.alive(key)) return;
    const now = this.deps.now();
    const p = parseProbe(r.stdout);
    if (!p.mem && !p.cpu && !p.disks.length) {
      this.patch(key, this.failure(key, r.timedOut ? "El servidor tardó demasiado en responder" : p.noProc ? "No es Linux: no hay /proc" : "No se pudo leer el estado"));
      return;
    }
    const prev = this.prevCpu.get(key);
    const cpuPct = p.cpuPct ?? cpuPercent(prev, p.cpu)?.cpu ?? null;
    if (p.cpu) this.prevCpu.set(key, p.cpu);
    const sudo = new Set(p.users.filter((u) => u.sudo).map((u) => u.name));
    if (p.users.length) this.sudoUsers.set(key, sudo);
    const l = this.live.get(key) ?? emptyLive();
    this.patch(key, {
      status: "online",
      probe: p,
      cpuPct,
      latencyMs: Math.max(0, now - t0 - (warmup ? WARMUP_MS : 0)),
      at: now,
      history: pushHistory(l.history, { at: now, cpu: cpuPct, mem: p.mem?.usedPct ?? null }),
      message: r.timedOut ? "La lectura no llegó entera" : null,
      attention: null,
      failures: 0,
      nextAt: now + this.intervalMs,
    });
  }

  private patch(key: string, p: Partial<VpsLive>) {
    const cur = this.live.get(key);
    if (!cur) return;
    this.live.set(key, { ...cur, ...p });
    this.emit();
  }

  private emit() {
    if (!this.disposed) this.onChange(Object.fromEntries(this.live));
  }
}
