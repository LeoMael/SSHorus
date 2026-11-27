// Tareas de cron: el crontab de cada usuario (editar, pausar, borrar una línea sin tocar las demás), los
// archivos del sistema (/etc/crontab y /etc/cron.d, para abrir en el editor) y las carpetas cron.daily…
import type { ReactNode } from "react";
import { FileText, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { cronChange, jobLine, type CronJob, type ScheduleRead, type UserCrontab } from "../../../features/schedule";
import type { ConfigChange } from "../../../features/serverConfig";
import { useAdmin } from "../context";

function JobRow({ job, user, children }: { job: CronJob; user?: string | null; children?: ReactNode }) {
  return (
    <div className={`svc-item cron-item${job.paused ? " svc-item-muted" : ""}`}>
      <span title={job.text} className={job.valid ? undefined : "cron-bad"}>
        {job.text}
        {job.paused && <span className="adm-tag svc-tag-off cron-tag">Pausada</span>}
      </span>
      <span className="svc-mono faint" title={job.schedule}>{job.schedule}</span>
      <span className="svc-mono" title={job.command}>
        {user ? <span className="faint">{user} · </span> : null}
        {job.command}
      </span>
      <span className="svc-actions">{children}</span>
    </div>
  );
}

export function CronView({ data, onChange, onEdit }: { data: ScheduleRead; onChange: (c: ConfigChange) => void; onEdit: (user: string, job: CronJob) => void }) {
  const { disabled, openFile } = useAdmin();
  const tabs = data.crontabs.filter((t): t is UserCrontab & { lines: string[] } => t.lines !== null);

  const pause = (t: UserCrontab & { lines: string[] }, j: CronJob) =>
    onChange(
      cronChange(t.user, t.lines, { kind: "replace", index: j.index, line: jobLine(j.schedule, j.command, !j.paused) }, `${j.paused ? "Reanudar" : "Pausar"} una tarea de ${t.user}`, j.paused ? `Vuelve a activar: ${j.text.toLowerCase()}, ${j.command}` : `La deja comentada (sin borrarla): ${j.command}`),
    );
  const remove = (t: UserCrontab & { lines: string[] }, j: CronJob) =>
    onChange(cronChange(t.user, t.lines, { kind: "remove", index: j.index }, `Borrar una tarea de ${t.user}`, `Borra la línea «${jobLine(j.schedule, j.command, j.paused)}». Las demás quedan igual.`));

  return (
    <div className="svc-scroll">
      {tabs.length === 0 && <div className="svc-empty">Nadie tiene tareas en su crontab{data.root ? "" : " (sin sudo solo se ve el tuyo)"}.</div>}
      {tabs.map((t) => (
        <div key={t.user} className="svc-section">
          <div className="svc-section-head">
            Crontab de {t.user}
            <span className="faint">{t.jobs.length ? `${t.jobs.length} tareas` : "sin tareas (solo comentarios o variables)"}</span>
          </div>
          {t.jobs.length > 0 && (
            <div className="svc-list">
              {t.jobs.map((j) => (
                <JobRow key={j.index} job={j}>
                  <button className="icon-btn adm-row-btn" onClick={() => onEdit(t.user, j)} disabled={disabled} title="Editar" aria-label="Editar la tarea">
                    <Pencil size={12} />
                  </button>
                  <button className="icon-btn adm-row-btn" onClick={() => pause(t, j)} disabled={disabled || !j.valid} title={j.paused ? "Reanudar" : "Pausar (la comenta sin borrarla)"} aria-label={j.paused ? "Reanudar la tarea" : "Pausar la tarea"}>
                    {j.paused ? <Play size={12} /> : <Pause size={12} />}
                  </button>
                  <button className="icon-btn adm-row-btn adm-btn-danger-soft" onClick={() => remove(t, j)} disabled={disabled} title="Borrar" aria-label="Borrar la tarea">
                    <Trash2 size={12} />
                  </button>
                </JobRow>
              ))}
            </div>
          )}
        </div>
      ))}
      {data.system.map((f) => (
        <div key={f.path} className="svc-section">
          <div className="svc-section-head">
            <span className="svc-mono">{f.path}</span>
            <span className="faint">{f.jobs === null ? "sin permiso para leerlo (hace falta sudo)" : "del sistema: cada línea dice con qué usuario corre"}</span>
            {openFile && (
              <button className="btn btn-sm" onClick={() => openFile(f.path)} title="Abrirlo en el editor (para cambiarlo, guarda con sudo)">
                <FileText size={12} /> Abrir
              </button>
            )}
          </div>
          {f.jobs && f.jobs.length > 0 && (
            <div className="svc-list">
              {f.jobs.map((j) => (
                <JobRow key={j.index} job={j} user={j.user} />
              ))}
            </div>
          )}
        </div>
      ))}
      {data.dirs.some((d) => d.scripts.length) && (
        <div className="svc-section">
          <div className="svc-section-head">
            Scripts periódicos <span className="faint">(cada archivo de estas carpetas se ejecuta con esa frecuencia)</span>
          </div>
          <div className="svc-list">
            {data.dirs
              .filter((d) => d.scripts.length)
              .map((d) => (
                <div key={d.path} className="svc-item cron-dir">
                  <span className="svc-mono">{d.path}</span>
                  <span className="faint" title={d.scripts.join(", ")}>{d.scripts.join(", ")}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
