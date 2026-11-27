// Sub-pestaña «Tareas»: lo que el servidor hace solo cada cierto tiempo. Cron (crontab de cada usuario
// con sudo, /etc/crontab, /etc/cron.d y cron.daily…) y timers de systemd, con el horario en palabras.
// Crear, editar, pausar o borrar una línea de cron reescribe el crontab entero sin perder las demás.
import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, KeyRound, Plus, RefreshCw } from "lucide-react";
import { loadSchedule, SCHEDULE_JOB, scheduleCache, type CronJob } from "../../../features/schedule";
import type { ConfigChange } from "../../../features/serverConfig";
import { Segmented } from "../../ui/Segmented";
import { ConfigChangeDialog } from "../config/ConfigChangeDialog";
import { useAdmin } from "../context";
import { useTabRead } from "../useTabRead";
import { CronEditDialog } from "./CronEditDialog";
import { CronView } from "./CronView";
import { TimersView } from "./TimersView";
import "../audit/AuditFix.css";
import "../AdminOps.css";

type View = "cron" | "timers";

export function TasksTab() {
  const { sessionId, elevation, elev, disabled, askSudo } = useAdmin();
  const entry = scheduleCache.useEntry(sessionId);
  const data = entry.data;
  const [view, setView] = useState<View>("cron");
  const [change, setChange] = useState<ConfigChange | null>(null);
  const [editing, setEditing] = useState<{ user: string; job: CronJob } | null | "new">(null);
  const load = useCallback(() => void loadSchedule(sessionId, elevation), [sessionId, elevation]);
  useTabRead({ sessionId, jobKind: SCHEDULE_JOB, hasData: !!data, elevatedData: !!data?.root, disabled, elevation, load });

  const users = useMemo(() => {
    if (!data) return [];
    const all = data.root ? ["root", ...data.crontabs.map((t) => t.user), ...data.humans] : [data.me ?? "root"];
    return [...new Set(all)];
  }, [data]);
  const cronCount = data ? data.crontabs.reduce((n, t) => n + t.jobs.length, 0) + data.system.reduce((n, f) => n + (f.jobs?.length ?? 0), 0) : 0;

  return (
    <div className="adm-pane">
      <div className="adm-toolbar">
        <Segmented<View>
          label="Qué ver"
          value={view}
          onChange={setView}
          options={[
            { value: "cron", label: <>Cron <span className="adm-seg-n">{data ? cronCount : "…"}</span></> },
            { value: "timers", label: <>Timers de systemd <span className="adm-seg-n">{data?.timers ? data.timers.length : "—"}</span></> },
          ]}
        />
        {view === "cron" && data?.hasCrontab && (
          <button className="btn btn-sm btn-primary" onClick={() => setEditing("new")} disabled={disabled}>
            <Plus size={13} /> Nueva tarea…
          </button>
        )}
        <button className="btn btn-sm" onClick={load} disabled={disabled || entry.loading} title="Vuelve a leer las tareas (solo lee)">
          {entry.loading ? <span className="spinner adm-spinner-btn" /> : <RefreshCw size={13} />} Volver a leer
        </button>
        {!elevation && elev.canAskSudo && (
          <button className="btn btn-sm" onClick={askSudo} title="Con sudo se ven los crontab de todos los usuarios">
            <KeyRound size={13} /> Con sudo…
          </button>
        )}
      </div>
      {entry.error && <Warn text={`No se pudieron leer las tareas: ${entry.error}`} />}
      {data && !data.root && view === "cron" && <Warn text="Sin sudo solo se ve tu crontab y lo que se pueda leer de /etc." />}
      {data && view === "cron" && data.hasCrontab && !data.daemon && <Warn text="No se ve cron en marcha: las tareas de cron no se ejecutarán hasta que se arranque (búscalo en «Servicios»: crond o cron)." />}
      {!data ? (
        <div className="empty-state">
          {entry.loading ? <span className="spinner" /> : <CalendarClock size={22} />}
          <div>{entry.loading ? "Leyendo las tareas programadas…" : "Tareas programadas"}</div>
        </div>
      ) : view === "timers" ? (
        data.timers ? <TimersView timers={data.timers} onChange={setChange} /> : <div className="empty-state"><div>No aplica: este servidor no usa systemd.</div></div>
      ) : !data.hasCrontab && data.system.length === 0 ? (
        <div className="empty-state">
          <div>No aplica: cron no está instalado (no hay «crontab»).</div>
        </div>
      ) : (
        <CronView data={data} onChange={setChange} onEdit={(user, job) => setEditing({ user, job })} />
      )}
      {editing && data && (
        <CronEditDialog
          users={editing === "new" ? users : [editing.user]}
          tabs={data.crontabs}
          edit={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onReview={(c) => {
            setEditing(null);
            setChange(c);
          }}
        />
      )}
      {change && <ConfigChangeDialog change={change} kind={SCHEDULE_JOB} area="Tareas programadas" onClose={() => setChange(null)} />}
    </div>
  );
}

function Warn({ text }: { text: string }) {
  return (
    <div className="adm-banner adm-banner-warn" role="status">
      <AlertTriangle size={14} />
      <span className="adm-banner-text">{text}</span>
    </div>
  );
}
