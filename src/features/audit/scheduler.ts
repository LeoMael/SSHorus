// Planificador de la auditoría programada. Solo funciona con SSHorus abierto: mira cada 5 minutos qué toca y,
// al abrir la app, pone al día lo atrasado (una sola vez, aunque se perdieran varios días). Una sola tanda a la
// vez (dentro, como mucho 3 servidores a la vez). Con SSHorus bloqueado lo salta, lo apunta y lo hace al
// desbloquear. Al terminar solo avisa si algo empeoró (con «Ver») o si no se pudo auditar algún servidor; si
// no cambia nada, queda solo en el historial. La tanda (scheduleJob.ts) se carga al hacer falta.
import { useProfiles } from "../../stores/profiles";
import { toast } from "../../stores/toasts";
import { useLock } from "../lock/lockStore";
import { diffSentence } from "./auditDiff";
import { rowBusy } from "./projectAudit";
import { useProjectAudit } from "./projectStore";
import {
  CANCELED,
  LOCKED_NOTE,
  canceledKeys,
  chooseEvery,
  keyServers,
  markRun,
  markSkipped,
  outcomeNote,
  planTick,
  pruneSchedules,
  scheduleKey,
  worsenedChanges,
  type AuditEvery,
  type ScheduleKind,
  type ServerOutcome,
} from "./schedule";
import { openAuditChanges, updateSchedules, useAuditSchedule } from "./scheduleStore";

const TICK_MS = 5 * 60_000;
/** Al abrir SSHorus, un rato antes de la primera vuelta: que arranque tranquilo. */
const FIRST_MS = 60_000;
/** Tras programar algo o desbloquear. */
const SOON_MS = 5_000;

let started = false;
let running = false;
let soonTimer: ReturnType<typeof setTimeout> | undefined;

function soon(): void {
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => void tick(), SOON_MS);
}

/** Arranca el planificador (una vez, al abrir la ventana principal). */
export function initAuditSchedule(): void {
  if (started) return;
  started = true;
  setTimeout(() => void tick(), FIRST_MS);
  setInterval(() => void tick(), TICK_MS);
  useLock.subscribe((s, prev) => {
    if (prev.status?.locked && s.status && !s.status.locked) soon();
  });
}

/**
 * «Repetir auditoría» de un servidor o proyecto (`every` null = nunca). `lastAudit` (ms): la última auditoría
 * que ya hay, para que la primera repetición cuente desde ella.
 */
export function setAuditSchedule(kind: ScheduleKind, id: string, every: AuditEvery | null, lastAudit: number | null): void {
  const key = scheduleKey(kind, id);
  updateSchedules((s) => {
    if (every) return { ...s, [key]: chooseEvery(s[key], every, lastAudit) };
    if (!s[key]) return s;
    const out = { ...s };
    delete out[key];
    return out;
  });
  if (every) soon();
}

async function tick(): Promise<void> {
  if (running) return;
  const prof = useProfiles.getState();
  if (!prof.loaded) return;
  const serverIds = prof.servers.map((s) => s.id);
  // Sin ningún servidor puede ser que no se pudieran leer los perfiles: mejor no borrar nada.
  if (serverIds.length) updateSchedules((s) => pruneSchedules(s, serverIds, prof.projects.map((p) => p.id)));
  const lock = useLock.getState().status;
  const now = Date.now();
  const plan = planTick({
    entries: useAuditSchedule.getState().entries,
    projects: prof.projects,
    serverIds,
    now,
    locked: lock ? lock.locked : null,
    busy: (id) => rowBusy(useProjectAudit.getState().rows[id]),
  });
  if (plan.kind === "none") return;
  if (plan.kind === "skip") return updateSchedules((s) => markSkipped(s, plan.keys, plan.note));
  if (!plan.servers.length) return finish(plan.keys, [], now);
  running = true;
  try {
    const { startScheduledAudit } = await import("./scheduleJob");
    const targets = plan.servers.map((id) => ({ profileId: id, name: prof.getServer(id)?.name ?? id }));
    startScheduledAudit(targets, (outcomes) => {
      running = false;
      finish(plan.keys, outcomes, now);
    });
  } catch {
    // No se pudo cargar la tanda: se reintenta en la próxima vuelta.
    running = false;
  }
}

function finish(keys: string[], outcomes: ServerOutcome[], at: number): void {
  const projects = useProfiles.getState().projects;
  // Cortada por el bloqueo: lo que no se auditó sigue vencido y se hace al desbloquear.
  const cut = useLock.getState().status?.locked ? canceledKeys(keys, outcomes, projects) : [];
  const done = keys.filter((k) => !cut.includes(k));
  const notes: Record<string, string> = {};
  for (const k of done) {
    const ids = keyServers(k, projects);
    notes[k] = outcomeNote(outcomes.filter((o) => ids.includes(o.profileId)));
  }
  updateSchedules((s) => markSkipped(markRun(s, done, at, notes), cut, LOCKED_NOTE));
  notify(outcomes);
}

function notify(outcomes: ServerOutcome[]): void {
  const worse = worsenedChanges(outcomes);
  if (worse.length) {
    const one = worse.length === 1;
    toast.error(
      one ? `La seguridad de ${worse[0].name} empeoró` : `La seguridad empeoró en ${worse.length} servidores`,
      one ? diffSentence(worse[0].diff) : worse.map((w) => w.name).join(", "),
      { action: { label: "Ver", onClick: () => openAuditChanges(worse) }, ms: 20_000 },
    );
  }
  const failed = outcomes.filter((o) => o.error && o.error !== CANCELED);
  if (failed.length) {
    toast.info("Auditoría programada: no se pudo hacer todo", failed.map((o) => `${o.name}: ${o.error}`).join(" · "), { ms: 12_000 });
  }
}
