// Estadísticas de contenedores de una sesión: cada 10 s y solo mientras alguien las pide.
import { snippets } from "../../api/snippets";
import { errorMessage } from "../../api/core";
import type { SampleInfo } from "./sample";
import { buildContainersCommand, CONTAINERS_TIMEOUT_SECS, parseContainers, type ContainerStat } from "./containers";
import { CONTAINERS_INTERVAL } from "./prefs";
import { EMPTY_CONTAINERS, useMonitorStore, type ContainersState } from "./store";

export class ContainersPoller {
  private demands = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastStart = 0;
  private disposed = false;

  constructor(
    private readonly sessionId: string,
    /** Lo último que se sabe del servidor (si tiene docker o podman). */
    private readonly info: () => SampleInfo | null,
    /** Cada lectura correcta, para aprender los nombres de los contenedores. */
    private readonly onContainers: (containers: ContainerStat[]) => void,
  ) {}

  get hasDemand() {
    return this.demands.size > 0;
  }

  setDemand(owner: string, on: boolean) {
    if (on) this.demands.add(owner);
    else this.demands.delete(owner);
    this.schedule();
  }

  private schedule() {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running || !this.demands.size) return;
    const info = this.info();
    if (info && !info.docker && !info.podman) {
      // Sin motor de contenedores: se vuelve a mirar cuando llegue otra muestra completa.
      this.timer = setTimeout(() => this.schedule(), CONTAINERS_INTERVAL);
      return;
    }
    const wait = Math.max(0, this.lastStart + CONTAINERS_INTERVAL - Date.now());
    this.timer = setTimeout(() => void this.tick(), wait);
  }

  private patch(p: Partial<ContainersState>) {
    const cur = useMonitorStore.getState().bySession[this.sessionId]?.containers ?? EMPTY_CONTAINERS;
    useMonitorStore.getState().patch(this.sessionId, { containers: { ...cur, ...p } });
  }

  private async tick() {
    this.timer = null;
    if (this.disposed || this.running) return;
    if (!this.info()) {
      // Aún no se sabe si hay docker/podman: esperar a la primera muestra.
      this.timer = setTimeout(() => this.schedule(), 1000);
      return;
    }
    this.running = true;
    this.lastStart = Date.now();
    this.patch({ loading: true });
    try {
      const r = await snippets.exec(this.sessionId, buildContainersCommand(), CONTAINERS_TIMEOUT_SECS);
      if (this.disposed) return;
      if (r.timedOut) this.patch({ loading: false, error: "Las estadísticas de contenedores tardaron demasiado" });
      else {
        const result = parseContainers(r.stdout);
        this.onContainers(result.containers);
        this.patch({ loading: false, error: null, result, at: Date.now() });
      }
    } catch (e) {
      if (!this.disposed) this.patch({ loading: false, error: errorMessage(e) });
    } finally {
      this.running = false;
      this.schedule();
    }
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.demands.clear();
  }
}
