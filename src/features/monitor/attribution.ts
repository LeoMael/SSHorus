// Memoria del muestreo para saber de qué contenedor es cada proceso. Cada proceso se pregunta una sola
// vez (su cgroup no cambia) y cada `conmon` también: en una muestra normal no se añade nada al script.
import {
  attributionParts,
  MAX_CGROUP_PIDS,
  parseCgroupLines,
  parseConmonLines,
  parseSubuid,
  shortId,
  subuidOwner,
  type ContainerRef,
  type ProcContainer,
  type SubIdRange,
} from "./containerUids";
import type { ProcStat, RawSample } from "./sample";

interface Known<T> {
  start: number;
  value: T;
}


export class ContainerAttribution {
  private ranges: SubIdRange[] = [];
  /** pid → contenedor (null = no es de ninguno), con su arranque para no confundir pids reutilizados. */
  private cgroups = new Map<number, Known<ContainerRef | null>>();
  /** pid de conmon ya leídos. */
  private conmons = new Map<number, number>();
  /** id corto → nombre. */
  private names = new Map<string, string>();
  private askCg: number[] = [];
  private askConmon: number[] = [];
  /** cgroups pedidos en el último script (lo que no salió no es de ningún contenedor). */
  private asked: number[] = [];

  /** Partes para el próximo muestreo (vacío si no falta nada). */
  parts(): string[] {
    this.asked = this.askCg;
    return attributionParts(this.askCg, this.askConmon);
  }

  /** Lee lo que trajo la muestra (antes de calcular las filas). */
  absorb(raw: RawSample): void {
    const subuid = raw.sections.get("subuid");
    if (subuid) this.ranges = parseSubuid(subuid);
    const start = new Map(raw.procs.map((p) => [p.pid, p.start]));
    // Pid reutilizado: lo de antes ya no vale.
    for (const [pid, k] of this.cgroups) if (start.get(pid) !== k.start) this.cgroups.delete(pid);
    for (const [pid, s] of this.conmons) if (start.get(pid) !== s) this.conmons.delete(pid);

    const cg = raw.sections.get("cg");
    if (cg && raw.complete) {
      const found = parseCgroupLines(cg);
      // Con muchos se leyeron todos (ver attributionParts).
      const asked = this.asked.length > MAX_CGROUP_PIDS ? [...start.keys()] : this.asked;
      for (const pid of asked) {
        const s = start.get(pid);
        if (s !== undefined && !this.cgroups.has(pid)) this.cgroups.set(pid, { start: s, value: found.get(pid) ?? null });
      }
    }
    const cm = raw.sections.get("conmon");
    if (cm) {
      for (const c of parseConmonLines(cm).values()) if (c.name) this.names.set(c.id, c.name);
      for (const l of cm) {
        const pid = Number(l.trim().split(/\s/)[0]);
        const s = start.get(pid);
        if (s !== undefined) this.conmons.set(pid, s);
      }
    }
  }

  /** Nombres de la lista de `podman|docker stats` (contenedores del usuario conectado). */
  learnNames(list: { id: string; name: string }[]): void {
    for (const c of list) if (c.id && c.name) this.names.set(shortId(c.id), c.name);
  }

  /** Contenedor del proceso (para las filas). `userOf`: nombre de un uid. */
  containerOf(p: ProcStat, uid: number | null, userOf: (uid: number) => string | null): ProcContainer | null {
    const sub = uid === null ? null : subuidOwner(uid, this.ranges, userOf);
    const k = this.cgroups.get(p.pid);
    const ref = k && k.start === p.start ? k.value : null;
    if (!sub && !ref) return null;
    return {
      owner: sub?.owner ?? (uid === null ? null : userOf(uid)),
      innerUid: sub?.innerUid ?? null,
      engine: ref?.engine ?? (sub ? "podman" : null),
      id: ref?.id ?? null,
      name: ref ? (this.names.get(ref.id) ?? null) : null,
    };
  }

  /**
   * Qué preguntar la próxima vez: el cgroup de los procesos nuevos (solo si el servidor tiene contenedores)
   * y la línea de órdenes de los conmon nuevos.
   */
  plan(procs: { pid: number; comm: string }[], hasEngine: boolean): void {
    const any = hasEngine || this.ranges.length > 0;
    this.askCg = any ? procs.filter((p) => !this.cgroups.has(p.pid)).map((p) => p.pid) : [];
    this.askConmon = procs.filter((p) => p.comm === "conmon" && !this.conmons.has(p.pid)).map((p) => p.pid);
  }
}
