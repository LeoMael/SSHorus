// Una tarea en segundo plano entera: estado, tiempos, pasos, progreso, aviso si no sale nada, error o
// resultado, botones propios, «Cancelar», «Copiar salida» y la salida en vivo. La usan la vista grande y,
// en pequeño (`compact`), los diálogos y paneles que lanzaron la tarea.
import { useLayoutEffect, useRef } from "react";
import { AlertTriangle, Copy, Maximize2, Square, X } from "lucide-react";
import { cancelJob, elapsedText, goToJob, jobStall, STATUS_TEXT, statusLine, type Job, type JobAction } from "../../features/jobs";
import { clipboard } from "../../lib/clipboard";
import { closeJobCenter, openJobCenter, removeJob } from "../../stores/jobs";
import { toast } from "../../stores/toasts";
import { JobProgressBar, JobStatusIcon, JobSteps, useNow } from "./JobBits";
import "./Jobs.css";

const TIME = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Botón propio de una tarea: primero se va a donde se lanzó (su diálogo vive allí). */
export function runJobAction(job: Job, a: JobAction): void {
  closeJobCenter();
  goToJob(job);
  a.run();
}

export function copyJobOutput(job: Job): void {
  const text = [job.dropped ? `(… ${job.dropped} líneas anteriores sin guardar)` : "", ...job.lines].filter(Boolean).join("\n");
  clipboard.write(text).then(
    () => toast.success("Salida copiada"),
    (e) => toast.error("No se pudo copiar", e),
  );
}

function JobOutputView({ job, compact }: { job: Job; compact: boolean }) {
  const pre = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  // Baja sola mientras se está viendo el final.
  useLayoutEffect(() => {
    const el = pre.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [job.lines]);
  const empty = job.status === "running" ? "Esperando la primera salida…" : "(sin salida)";
  return (
    <pre
      ref={pre}
      className={compact ? "jb-out jb-out-sm" : "jb-out"}
      aria-label="Salida"
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {job.dropped > 0 && <span className="faint">{`(… ${job.dropped} líneas anteriores sin guardar)\n`}</span>}
      {job.lines.length ? job.lines.join("\n") : empty}
    </pre>
  );
}

export function JobPanel({ job, compact = false }: { job: Job; compact?: boolean }) {
  const running = job.status === "running";
  const now = useNow(running);
  const stall = jobStall(job, now);
  const View = job.view;
  const hasOutput = job.watchOutput || job.lines.length > 0;

  return (
    <div className={compact ? "jb-panel jb-panel-compact" : "jb-panel"}>
      <div className="jb-head">
        <JobStatusIcon status={job.status} />
        <strong className="jb-ellipsis">{job.title}</strong>
        <span className="faint jb-ellipsis">{[job.server, job.detail].filter(Boolean).join(" · ")}</span>
        <span className="jb-grow" />
        <span className="faint jb-nowrap">
          {job.stopping ? "Deteniendo…" : STATUS_TEXT[job.status]} · <span className="mono">{elapsedText(job, now)}</span>
        </span>
      </div>
      {!compact && (
        <div className="faint jb-times">
          Empezó a las {TIME.format(job.startedAt)}
          {job.endedAt !== null && ` · terminó a las ${TIME.format(job.endedAt)}`}
        </div>
      )}
      {job.steps.length > 0 && <JobSteps steps={job.steps} />}
      {running && (
        <div className="jb-phase" role="status" aria-live="polite">
          {statusLine(job)}
        </div>
      )}
      {running && job.progress && <JobProgressBar progress={job.progress} />}
      {stall && <div className="jb-warn">{stall}</div>}
      {job.error && (
        <div className="jb-error" role="alert">
          <AlertTriangle size={14} />
          <pre>{job.error}</pre>
        </div>
      )}
      {!running && job.summary && (
        <div className={job.status === "done" ? "jb-summary jb-summary-ok" : "jb-summary"} role="status">
          {job.summary}
        </div>
      )}
      {View && <View job={job} />}
      <div className="jb-actions">
        {!running &&
          job.actions.map((a) => (
            <button key={a.label} className={a.primary ? "btn btn-sm btn-primary" : "btn btn-sm"} onClick={() => runJobAction(job, a)}>
              {a.label}
            </button>
          ))}
        {running && job.cancelLabel && (
          <button className="btn btn-sm" onClick={() => void cancelJob(job.id)} disabled={job.stopping} title="Detiene la tarea también en el servidor">
            <Square size={12} /> {job.cancelLabel}
          </button>
        )}
        <span className="jb-grow" />
        {hasOutput && (
          <button className="btn btn-sm" onClick={() => copyJobOutput(job)} disabled={!job.lines.length}>
            <Copy size={12} /> Copiar salida
          </button>
        )}
        {compact && (
          <button className="btn btn-sm" onClick={() => openJobCenter({ jobId: job.id })} title="Ver la tarea en grande (también desde la esquina de abajo a la derecha)">
            <Maximize2 size={12} /> Ver en grande
          </button>
        )}
        {!running && (
          <button className="icon-btn" onClick={() => removeJob(job.id)} title="Quitar de la lista" aria-label="Quitar de la lista">
            <X size={13} />
          </button>
        )}
      </div>
      {hasOutput && <JobOutputView job={job} compact={compact} />}
    </div>
  );
}
