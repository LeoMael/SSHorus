// Motor de "Ejecutar en varios servidores": cola con concurrencia limitada, conexión en segundo plano,
// ejecución, cancelación y reintentos. No depende de Tauri: las llamadas reales se inyectan (EngineDeps),
// así se puede probar con un motor simulado.
import type { EngineDeps } from "./deps";
import { STOP_WAIT_MS, Slots, delay, requestCancel, type InFlight } from "./inflight";
import { blankTarget, classifyConnectError, errText, execOutcome, type ExecOutcome } from "./outcome";
import { isFinal, type RunSpec, type TargetInput, type TargetState } from "./types";

export type { EngineDeps } from "./deps";
export { classifyConnectError, errText, type ConnectFailure } from "./outcome";

export class RunEngine {
  private list: TargetState[];
  private readonly gen = new Map<string, number>();
  /** Sesiones abiertas por la ejecución y aún sin cerrar (profileId → sessionId). */
  private readonly owned = new Map<string, string>();
  /** Comandos ejecutándose ahora (profileId → ejecución). */
  private readonly inFlight = new Map<string, InFlight>();
  /** Esperas de la contraseña de sudo (profileId → para quitar su diálogo de la cola al cancelar). */
  private readonly sudoWaits = new Map<string, AbortController>();
  private readonly slots = new Slots(() => this.spec.concurrency);
  private disposed = false;

  constructor(
    readonly spec: RunSpec,
    inputs: TargetInput[],
    private readonly deps: EngineDeps,
    private readonly onChange: (targets: TargetState[]) => void,
  ) {
    this.list = inputs.map(blankTarget);
  }

  get targets(): TargetState[] {
    return this.list;
  }

  /** Lanza todos los servidores (respetando la concurrencia). */
  start(): void {
    for (const t of this.list) void this.runOne(t.profileId, false);
  }

  /** Vuelve a ejecutar un servidor terminado (o que requiere atención) sin diálogos. */
  retry(profileId: string): void {
    const t = this.find(profileId);
    if (!t || this.disposed || !(isFinal(t.status) || t.status === "attention")) return;
    void this.runOne(profileId, false);
  }

  /** Reintenta todos los que fallaron, se agotaron o se cancelaron. */
  retryFailed(): void {
    for (const t of this.list) if (t.status === "error" || t.status === "timeout" || t.status === "canceled") this.retry(t.profileId);
  }

  /** Resuelve la conexión con diálogos y continúa. Promesa: termina cuando acaba la fase de conexión. */
  resolve(profileId: string): Promise<void> {
    const t = this.find(profileId);
    if (!t || this.disposed || t.status !== "attention") return Promise.resolve();
    return new Promise((res) => void this.runOne(profileId, true, res));
  }

  /** Resuelve uno tras otro todos los que requieren atención (los diálogos no se mezclan). */
  async resolveAll(): Promise<void> {
    for (const t of this.list.slice()) {
      if (this.disposed) return;
      if (this.find(t.profileId)?.status === "attention") await this.resolve(t.profileId);
    }
  }

  cancel(profileId: string): void {
    const t = this.find(profileId);
    if (!t || isFinal(t.status)) return;
    this.bump(profileId);
    this.sudoWaits.get(profileId)?.abort();
    this.sudoWaits.delete(profileId);
    const ex = this.inFlight.get(profileId);
    this.patch(profileId, {
      status: "canceled",
      finishedAt: Date.now(),
      detail: ex ? "Cancelado. Se pidió al servidor detener el comando." : "Cancelado",
    });
    if (ex) {
      this.inFlight.delete(profileId);
      this.stopExec(profileId, ex);
    } else {
      this.closeOwned(profileId);
    }
  }

  cancelAll(): void {
    for (const t of this.list) this.cancel(t.profileId);
  }

  /** ¿Queda algo en marcha (en cola, conectando o ejecutando)? */
  get busy(): boolean {
    return this.list.some((t) => t.status === "queued" || t.status === "connecting" || t.status === "running");
  }

  /**
   * Cancela todo y cierra las sesiones propias. Las que tenían un comando en marcha se cierran
   * cuando el servidor lo haya detenido (sin PTY, desconectar no basta para pararlo).
   */
  dispose(): void {
    this.cancelAll();
    this.disposed = true;
    for (const id of Array.from(this.owned.keys())) this.closeOwned(id);
  }

  // ───────── interno ─────────

  private find(profileId: string): TargetState | undefined {
    return this.list.find((t) => t.profileId === profileId);
  }

  private patch(profileId: string, p: Partial<TargetState>) {
    this.list = this.list.map((t) => (t.profileId === profileId ? { ...t, ...p } : t));
    this.onChange(this.list);
  }

  private bump(profileId: string): number {
    const g = (this.gen.get(profileId) ?? 0) + 1;
    this.gen.set(profileId, g);
    return g;
  }

  /** Cierra la sesión propia del servidor (solo si es `only`, cuando se indica). */
  private closeOwned(profileId: string, only?: string) {
    const sid = this.owned.get(profileId);
    if (!sid || (only !== undefined && sid !== only)) return;
    this.owned.delete(profileId);
    this.deps.disconnect(sid).catch(() => {
      /* ya estaba cerrada */
    });
  }

  /**
   * Detiene en el servidor un comando en marcha (pestaña o sesión propia). La sesión propia se cierra
   * después, cuando `exec` termine (el motor necesita la sesión para mandar TERM/KILL), o como mucho
   * a los STOP_WAIT_MS.
   */
  private stopExec(profileId: string, ex: InFlight) {
    void requestCancel(ex, (id) => this.deps.cancelExec(id));
    if (!ex.owned) return;
    // Se quita de la lista ya: un reintento puede abrir otra sesión para el mismo servidor.
    if (this.owned.get(profileId) === ex.sessionId) this.owned.delete(profileId);
    void Promise.race([ex.settled, delay(STOP_WAIT_MS)]).then(() =>
      this.deps.disconnect(ex.sessionId).catch(() => {
        /* ya estaba cerrada */
      }),
    );
  }

  /**
   * Contraseña de sudo para este servidor si el comando la necesita: undefined = ejecutar tal cual (no se
   * usa sudo con contraseña, root, sudo sin contraseña…); null = el usuario saltó el servidor.
   */
  private async sudoPasswordFor(profileId: string, sessionId: string, name: string): Promise<string | null | undefined> {
    if (!this.spec.sudoPassword || !this.deps.sudoPassword || !this.deps.execSudo) return undefined;
    this.patch(profileId, { detail: "Buscando la contraseña de sudo…" });
    const ac = new AbortController();
    this.sudoWaits.set(profileId, ac);
    try {
      const got = await this.deps.sudoPassword(sessionId, profileId, name, ac.signal).catch(() => null);
      if (got === null) return null;
      return "password" in got ? got.password : undefined;
    } finally {
      if (this.sudoWaits.get(profileId) === ac) this.sudoWaits.delete(profileId);
    }
  }

  private async runOne(profileId: string, interactive: boolean, onConnectDone?: () => void): Promise<void> {
    const g = this.bump(profileId);
    const stale = () => this.disposed || this.gen.get(profileId) !== g;
    let connectDone = false;
    const doneConnecting = () => {
      if (!connectDone) {
        connectDone = true;
        onConnectDone?.();
      }
    };
    const prev = this.find(profileId);
    if (!prev) return doneConnecting();
    this.patch(profileId, {
      ...blankTarget(prev),
      // Al resolver, se conserva el motivo hasta que se conecte.
      status: interactive ? "connecting" : "queued",
      attention: interactive ? prev.attention : null,
      detail: interactive ? prev.detail : null,
      connectStartedAt: interactive ? Date.now() : null,
    });

    if (!interactive) await this.slots.acquire();
    try {
      if (stale()) return;
      const t = this.find(profileId);
      if (!t) return;
      this.patch(profileId, { status: "connecting", connectStartedAt: t.connectStartedAt ?? Date.now() });

      let sessionId: string | null = this.deps.tabSession(profileId);
      const reused = sessionId !== null;
      if (sessionId === null) {
        try {
          sessionId = interactive ? await this.deps.connectInteractive(profileId) : await this.deps.connect(profileId);
        } catch (e) {
          if (stale()) return;
          const f = classifyConnectError(e, t.auth);
          if (f.attention && !interactive) {
            this.patch(profileId, { status: "attention", attention: f.attention, detail: f.message });
          } else {
            this.patch(profileId, { status: "error", attention: null, detail: f.message, finishedAt: Date.now() });
          }
          return;
        }
        if (sessionId === null) {
          // El usuario cerró el diálogo: sigue requiriendo atención.
          if (!stale()) this.patch(profileId, { status: "attention", connectStartedAt: null });
          return;
        }
        if (stale()) {
          this.deps.disconnect(sessionId).catch(() => {});
          return;
        }
        this.owned.set(profileId, sessionId);
      }
      doneConnecting();
      this.patch(profileId, { sessionId, owned: !reused, reused, attention: null, detail: null });

      try {
        if (this.spec.usesSudo) {
          const p = await this.deps.privilege(sessionId, reused).catch(() => null);
          if (stale()) return;
          this.patch(profileId, { privilege: p });
        }
        if (stale()) return;
        const password = await this.sudoPasswordFor(profileId, sessionId, t.name);
        if (stale()) return;
        if (password === null) {
          this.patch(profileId, {
            status: "canceled",
            detail: "Saltado: sin contraseña de sudo",
            finishedAt: Date.now(),
          });
          return;
        }
        this.patch(profileId, { status: "running", execStartedAt: Date.now(), detail: null });
        const execId = this.deps.newExecId();
        const pending: Promise<ExecOutcome> =
          password !== undefined && this.deps.execSudo
            ? this.deps.execSudo(sessionId, this.spec.command, password, this.spec.timeoutSecs, execId)
            : this.deps.exec(sessionId, this.spec.command, this.spec.timeoutSecs, execId);
        const ex: InFlight = {
          execId,
          sessionId,
          owned: !reused,
          settled: pending.then(
            () => {},
            () => {},
          ),
        };
        this.inFlight.set(profileId, ex);
        let r: ExecOutcome;
        try {
          r = await pending;
        } finally {
          if (this.inFlight.get(profileId) === ex) this.inFlight.delete(profileId);
        }
        if (stale()) return;
        if (r.sudoFailure === "bad-password") this.deps.sudoRejected?.(sessionId);
        this.patch(profileId, { ...execOutcome(r, this.spec.timeoutSecs), result: r, finishedAt: Date.now() });
      } catch (e) {
        if (stale()) return;
        this.patch(profileId, { status: "error", detail: errText(e), finishedAt: Date.now() });
      } finally {
        if (!reused) this.closeOwned(profileId, sessionId);
      }
    } finally {
      doneConnecting();
      if (!interactive) this.slots.release();
    }
  }
}
