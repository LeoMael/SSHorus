// «Repetir auditoría: nunca / cada día / cada semana» de un servidor (pestaña Auditoría) o de un proyecto
// («Auditar proyecto»), y la línea que explica cuándo toca y cómo fue. Solo funciona con SSHorus abierto.
import { CalendarClock } from "lucide-react";
import { EVERY_TEXT, SCHEDULE_OPTIONS, nextRunAt, scheduleKey, setAuditSchedule, useAuditSchedule, type AuditEvery, type ScheduleKind } from "../../../features/audit";

const ONLY_OPEN = "Solo mientras SSHorus está abierto: si estaba cerrado, se pone al día al abrirlo (una vez). Avisa solo si algo empeora.";

function when(ms: number): string {
  return new Date(ms).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
}

interface Props {
  kind: ScheduleKind;
  id: string;
  /** Fecha (ISO) de la última auditoría que ya hay: la primera repetición cuenta desde ella. */
  lastAudit: string | null;
  disabled?: boolean;
}

export function AuditScheduleSelect({ kind, id, lastAudit, disabled }: Props) {
  const entry = useAuditSchedule((s) => s.entries[scheduleKey(kind, id)]);
  const change = (v: string) => {
    const last = lastAudit ? Date.parse(lastAudit) : NaN;
    setAuditSchedule(kind, id, v === "never" ? null : (v as AuditEvery), Number.isNaN(last) ? null : last);
  };
  return (
    <label className="au-sched" title={`Repite «Auditar ${kind === "server" ? "servidor" : "proyecto"}» sola. ${ONLY_OPEN}`}>
      <CalendarClock size={13} aria-hidden />
      <select className="input au-sched-select" value={entry?.every ?? "never"} onChange={(e) => change(e.target.value)} disabled={disabled} aria-label="Repetir auditoría">
        {SCHEDULE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** «Se repite cada día · próxima: … · última: …» (nada si no se repite). */
export function AuditScheduleHint({ kind, id }: Pick<Props, "kind" | "id">) {
  const entry = useAuditSchedule((s) => s.entries[scheduleKey(kind, id)]);
  if (!entry) return null;
  const now = Date.now();
  const next = nextRunAt(entry, now);
  return (
    <div className="au-sched-hint faint">
      <CalendarClock size={12} aria-hidden />
      <span>
        Se repite {EVERY_TEXT[entry.every]}. {ONLY_OPEN} Próxima: {next <= now ? "en cuanto se pueda" : when(next)}
        {entry.lastRun !== null && ` · Última: ${when(entry.lastRun)}`}
        {entry.note && ` (${entry.note})`}.
      </span>
    </div>
  );
}
