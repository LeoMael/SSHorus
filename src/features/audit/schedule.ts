// Auditoría programada: lo puro. Cada cuánto se repite, cuándo toca la próxima, qué servidores tocan ahora
// (una sola vez aunque se perdieran varios días con SSHorus cerrado), cómo se lee lo guardado y la nota de
// cómo fue. Se prueba en schedule.test.ts.
import { diffSentence, type AuditDiff } from "./auditDiff";

/** Tipo de la tarea en segundo plano de cada tanda (scheduleJob.ts). */
export const SCHEDULED_AUDIT_JOB = "scheduledaudit";

export type AuditEvery = "day" | "week";
export type ScheduleKind = "server" | "project";

export const SCHEDULE_OPTIONS: { value: AuditEvery | "never"; label: string }[] = [
  { value: "never", label: "Repetir: nunca" },
  { value: "day", label: "Repetir cada día" },
  { value: "week", label: "Repetir cada semana" },
];

const DAY_MS = 86_400_000;
export const EVERY_MS: Record<AuditEvery, number> = { day: DAY_MS, week: 7 * DAY_MS };

export const EVERY_TEXT: Record<AuditEvery, string> = { day: "cada día", week: "cada semana" };

/** La programación de un servidor o de un proyecto. */
export interface ScheduleEntry {
  every: AuditEvery;
  /** Última vez que se hizo o se intentó (ms). null = aún no: toca en cuanto se pueda. */
  lastRun: number | null;
  /** Cómo fue la última vez («Sin cambios», «No se pudo: …», «Saltada: …»). */
  note: string | null;
}

/** Clave `server:<id>` o `project:<id>` → programación. Sin clave = nunca. */
export type Schedules = Record<string, ScheduleEntry>;

export function scheduleKey(kind: ScheduleKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseKey(key: string): { kind: ScheduleKind; id: string } | null {
  const i = key.indexOf(":");
  const kind = key.slice(0, i);
  const id = key.slice(i + 1);
  return i > 0 && id && (kind === "server" || kind === "project") ? { kind, id } : null;
}

/** Cuándo toca la próxima (ms). Sin ninguna hecha, ya. */
export function nextRunAt(e: ScheduleEntry, now: number): number {
  return e.lastRun === null ? now : e.lastRun + EVERY_MS[e.every];
}

export function isDue(e: ScheduleEntry, now: number): boolean {
  return now >= nextRunAt(e, now);
}

/**
 * Elegir «cada día» o «cada semana». Si ya había programación, solo cambia el intervalo. Si no, cuenta desde
 * la última auditoría que ya hay (`lastAudit`, ms): así no se repite enseguida la que se acaba de hacer.
 */
export function chooseEvery(prev: ScheduleEntry | undefined, every: AuditEvery, lastAudit: number | null): ScheduleEntry {
  return prev ? { ...prev, every } : { every, lastRun: lastAudit, note: null };
}

export interface ProjectRef {
  id: string;
  serverIds: string[];
}

/** Lo que toca ahora: las claves vencidas y sus servidores (sin repetir, en orden, solo los que existen). */
export function dueNow(s: Schedules, projects: ProjectRef[], serverIds: string[], now: number): { keys: string[]; servers: string[] } {
  const exists = new Set(serverIds);
  const keys: string[] = [];
  const servers: string[] = [];
  const add = (id: string) => {
    if (exists.has(id) && !servers.includes(id)) servers.push(id);
  };
  for (const [key, e] of Object.entries(s)) {
    const k = parseKey(key);
    if (!k || !isDue(e, now)) continue;
    if (k.kind === "server") {
      if (!exists.has(k.id)) continue;
      add(k.id);
    } else {
      const p = projects.find((x) => x.id === k.id);
      if (!p) continue;
      p.serverIds.forEach(add);
    }
    keys.push(key);
  }
  return { keys, servers };
}

/** Los servidores que cubre una clave (un servidor o los de su proyecto). */
export function keyServers(key: string, projects: ProjectRef[]): string[] {
  const k = parseKey(key);
  if (!k) return [];
  return k.kind === "server" ? [k.id] : (projects.find((p) => p.id === k.id)?.serverIds ?? []);
}

/** Quita lo de servidores y proyectos que ya no existen. Devuelve el mismo objeto si no cambia nada. */
export function pruneSchedules(s: Schedules, serverIds: string[], projectIds: string[]): Schedules {
  const ok = { server: new Set(serverIds), project: new Set(projectIds) };
  const out: Schedules = {};
  let changed = false;
  for (const [key, e] of Object.entries(s)) {
    const k = parseKey(key);
    if (k && ok[k.kind].has(k.id)) out[key] = e;
    else changed = true;
  }
  return changed ? out : s;
}

/** Hecha (o intentada) ahora: la próxima, dentro de un intervalo. */
export function markRun(s: Schedules, keys: string[], now: number, notes: Record<string, string>): Schedules {
  const out = { ...s };
  for (const k of keys) if (out[k]) out[k] = { ...out[k], lastRun: now, note: notes[k] ?? out[k].note };
  return out;
}

/** Saltada (p. ej. con SSHorus bloqueado): sigue vencida, se hará en cuanto se pueda. Mismo objeto si nada cambia. */
export function markSkipped(s: Schedules, keys: string[], note: string): Schedules {
  if (keys.every((k) => !s[k] || s[k].note === note)) return s;
  const out = { ...s };
  for (const k of keys) if (out[k]) out[k] = { ...out[k], note };
  return out;
}

/** Lee lo guardado: descarta lo que no tenga la forma esperada. */
export function parseSchedules(raw: unknown): Schedules {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Schedules = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!parseKey(key) || !v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    if (e.every !== "day" && e.every !== "week") continue;
    out[key] = {
      every: e.every,
      lastRun: typeof e.lastRun === "number" && Number.isFinite(e.lastRun) ? e.lastRun : null,
      note: typeof e.note === "string" ? e.note : null,
    };
  }
  return out;
}

/** El `error` de un servidor que no se llegó a auditar porque se canceló la tanda. */
export const CANCELED = "Cancelado";

/** Cómo fue un servidor en la auditoría programada. */
export interface ServerOutcome {
  profileId: string;
  name: string;
  /** Por qué no se pudo (null = se auditó). */
  error: string | null;
  /** Comparación con la anterior (null = no había otra o no se pudo). */
  diff: AuditDiff | null;
}

/** Un servidor cuya auditoría cambió, para el diálogo de «Ver». */
export interface ServerChange {
  profileId: string;
  name: string;
  diff: AuditDiff;
}

/** Los servidores en los que algo empeoró. */
export function worsenedChanges(outcomes: ServerOutcome[]): ServerChange[] {
  return outcomes.flatMap((o) => (o.diff?.worsened ? [{ profileId: o.profileId, name: o.name, diff: o.diff }] : []));
}

function oneNote(o: ServerOutcome): string {
  if (o.error) return `No se pudo: ${o.error}`;
  if (!o.diff) return "Hecha (no había otra para comparar)";
  if (o.diff.worsened) return `Empeoró: ${diffSentence(o.diff)}`;
  if (o.diff.improved) return `Mejoró: ${diffSentence(o.diff)}`;
  return "Sin cambios";
}

/** La nota de una programación tras la tanda: «Sin cambios», «Empeoró: …» o, en un proyecto, un resumen. */
export function outcomeNote(list: ServerOutcome[]): string {
  if (list.length === 0) return "No había servidores que auditar";
  if (list.length === 1) return oneNote(list[0]);
  const done = list.filter((o) => !o.error);
  const worse = done.filter((o) => o.diff?.worsened).length;
  const failed = list.length - done.length;
  const parts = [`${done.length} de ${list.length} auditados`];
  if (done.length) parts.push(worse ? `empeoró en ${worse}` : "nada empeoró");
  if (failed) parts.push(`${failed} no se ${failed === 1 ? "pudo" : "pudieron"}`);
  return parts.join(" · ");
}

export const LOCKED_NOTE = "Saltada: SSHorus estaba bloqueado (se hará al desbloquear)";

export interface TickInput {
  entries: Schedules;
  projects: ProjectRef[];
  serverIds: string[];
  now: number;
  /** null = aún no se sabe (el motor no ha contestado). */
  locked: boolean | null;
  /** Servidores que ya se están auditando (a mano o en otra tanda). */
  busy: (serverId: string) => boolean;
}

export type TickPlan =
  | { kind: "none" }
  /** Toca, pero no se puede ahora: se apunta por qué y se reintenta. */
  | { kind: "skip"; keys: string[]; note: string }
  | { kind: "run"; keys: string[]; servers: string[] };

/** Qué hacer en esta vuelta del planificador. */
export function planTick(t: TickInput): TickPlan {
  if (t.locked === null) return { kind: "none" };
  const { keys, servers } = dueNow(t.entries, t.projects, t.serverIds, t.now);
  if (!keys.length) return { kind: "none" };
  if (t.locked) return { kind: "skip", keys, note: LOCKED_NOTE };
  // Si alguno ya se está auditando, mejor esperar a la próxima vuelta que auditarlo dos veces a la vez.
  if (servers.some(t.busy)) return { kind: "none" };
  return { kind: "run", keys, servers };
}
