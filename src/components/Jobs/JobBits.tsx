// Piezas pequeñas de las tareas en segundo plano: icono de estado, reloj que avanza, pasos y barra de
// progreso. Las usan la ventanita de la esquina, la vista grande y los diálogos que siguen una tarea.
import { useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Circle, CircleSlash, X } from "lucide-react";
import type { JobProgress, JobStatus, JobStep, StepState } from "../../features/jobs";
import "./Jobs.css";

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
  if (status === "running") return <span className="spinner jb-spinner" aria-label="En marcha" />;
  if (status === "done") return <CheckCircle2 size={14} className="jb-ok" aria-label="Terminada" />;
  if (status === "canceled") return <CircleSlash size={14} className="faint" aria-label="Cancelada" />;
  return <AlertTriangle size={14} className="jb-bad" aria-label="Falló" />;
}

function StepIcon({ s }: { s: StepState }) {
  if (s === "done") return <Check size={12} />;
  if (s === "current") return <span className="spinner jb-spinner" />;
  if (s === "error") return <X size={12} />;
  return <Circle size={10} />;
}

const STEP_LABEL: Record<StepState, string> = { done: "hecho", current: "en curso", error: "no se completó", todo: "pendiente" };

export function JobSteps({ steps }: { steps: JobStep[] }) {
  return (
    <ol className="jb-steps" aria-label="Pasos">
      {steps.map((s) => (
        <li key={s.label} className={`jb-step jb-step-${s.state}`} aria-label={`${s.label}: ${STEP_LABEL[s.state]}`}>
          <StepIcon s={s.state} /> {s.label}
        </li>
      ))}
    </ol>
  );
}

export function JobProgressBar({ progress, label }: { progress: JobProgress; label?: boolean }) {
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  return (
    <div className="jb-progress">
      <div className="progress jb-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Progreso">
        <div style={{ width: `${pct}%` }} />
      </div>
      {label !== false && (
        <span className="faint mono">
          {progress.done}/{progress.total}
        </span>
      )}
    </div>
  );
}
