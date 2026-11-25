// Una tarea larga (en marcha o terminada): estado, tiempo, aviso si no sale nada, salida en vivo y
// botones (Cancelar, arreglar el nombre repetido, sudo, quitar de la lista).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleSlash, KeyRound, Square, Wrench, X } from "lucide-react";
import { cancelJob, useCtJobs, type CtJob, type JobStatus } from "../../features/containers/jobs";
import { stallText } from "../../features/containers/jobOutput";
import { formatDuration } from "../../lib/format";
import { useCt } from "./context";
import "./ComposeJobs.css";

const STATUS_TEXT: Record<JobStatus, string> = {
  running: "En marcha",
  done: "Terminada",
  failed: "Falló",
  canceled: "Cancelada",
};

/** Hora actual que se refresca cada segundo mientras `on`. */
export function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  return now;
}

export function JobStatusIcon({ status }: { status: JobStatus }) {
  if (status === "running") return <span className="spinner ct-spinner-xs" aria-label="En marcha" />;
  if (status === "done") return <CheckCircle2 size={14} className="ct-job-ok" aria-label="Terminada" />;
  if (status === "canceled") return <CircleSlash size={14} className="faint" aria-label="Cancelada" />;
  return <AlertTriangle size={14} className="ct-bad-text" aria-label="Falló" />;
}

/** Tiempo de la tarea y, si lleva un rato callada, el aviso. */
export function jobTiming(job: CtJob, now: number): { elapsed: string; stall: string | null } {
  const end = job.endedAt ?? now;
  return {
    elapsed: formatDuration((end - job.startedAt) / 1000),
    stall: job.status === "running" ? stallText((now - job.lastOutputAt) / 1000) : null,
  };
}

export function JobView({ job, onClose }: { job: CtJob; onClose?: () => void }) {
  const ct = useCt();
  const now = useNow(job.status === "running");
  const { elapsed, stall } = jobTiming(job, now);
  const pre = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  // La salida baja sola mientras se está viendo el final.
  useLayoutEffect(() => {
    const el = pre.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [job.lines]);

  return (
    <div className="ct-job">
      <div className="ct-job-head">
        <JobStatusIcon status={job.status} />
        <strong className="ct-ellipsis">{job.title}</strong>
        <span className="faint ct-small ct-ellipsis">{job.detail}</span>
        <span className="ct-grow" />
        <span className="faint ct-small">
          {job.stopping ? "Deteniendo…" : STATUS_TEXT[job.status]} · {elapsed}
        </span>
        {job.status === "running" ? (
          <button className="btn btn-sm" onClick={() => void cancelJob(job.id)} disabled={job.stopping} title="Detiene el proceso también en el servidor">
            <Square size={12} /> Cancelar
          </button>
        ) : (
          <button
            className="icon-btn"
            title="Quitar de la lista"
            aria-label="Quitar de la lista"
            onClick={() => {
              useCtJobs.getState().dismiss(job.id);
              onClose?.();
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {stall && <div className="ct-warn">{stall}</div>}
      {job.status === "failed" && job.conflicts.length > 0 && (
        <div className="ct-job-fix">
          <span>
            Ya existe un contenedor llamado <strong className="mono">{job.conflicts.map((c) => c.name).join(", ")}</strong> que esta herramienta no reconoce como
            suyo (lo creó otra herramienta, como podman-compose, o se hizo a mano).
          </span>
          <button className="btn btn-sm btn-primary" onClick={() => ct.fixConflict(job)}>
            <Wrench size={13} /> Ver y arreglar
          </button>
        </div>
      )}
      {job.status === "failed" && job.error && job.conflicts.length === 0 && (
        <div className="ct-error" role="alert">
          <AlertTriangle size={14} />
          <pre>{job.error}</pre>
        </div>
      )}
      {job.needSudo && (
        <button className="btn btn-sm" onClick={ct.askSudo}>
          <KeyRound size={13} /> Introducir contraseña de sudo
        </button>
      )}
      <pre
        ref={pre}
        className="ct-output ct-job-out"
        aria-live="off"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {job.lines.length ? job.lines.join("\n") : job.status === "running" ? "Esperando la primera salida…" : "(sin salida)"}
      </pre>
    </div>
  );
}
