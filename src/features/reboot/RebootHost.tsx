// Aviso flotante con el progreso de cada reinicio: pasos, tiempo transcurrido, resultado y botones
// («Dejar de esperar», «Reconectar», «Cerrar»). Lo monta App una vez; no bloquea el resto de la app.
import { useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Circle, Power, RotateCw, X } from "lucide-react";
import { formatElapsed, isActive, phaseDetail, phaseTitle, STEPS, stepStates, stillPending, type RebootRun, type StepState } from "./progress";
import { dismissReboot, reconnectAfterReboot, stopWaiting, useReboots } from "./store";
import "./Reboot.css";

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function StepIcon({ s }: { s: StepState }) {
  if (s === "done") return <Check size={12} />;
  if (s === "current") return <span className="spinner rb-step-spinner" />;
  if (s === "error") return <X size={12} />;
  return <Circle size={10} />;
}

function HeadIcon({ run }: { run: RebootRun }) {
  if (isActive(run.phase)) return <Power size={15} className="rb-ic-busy" />;
  if (run.phase === "done" && !stillPending(run) && !run.message) return <CheckCircle2 size={15} className="rb-ic-ok" />;
  return <AlertTriangle size={15} className="rb-ic-warn" />;
}

function RebootCard({ run }: { run: RebootRun }) {
  const active = isActive(run.phase);
  const now = useNow(active);
  const took = active ? now - run.startedAt : run.phase === "done" && run.backAt ? run.backAt - run.startedAt : null;
  const steps = stepStates(run);
  return (
    <div className={`rb-card rb-${run.phase}`} role="status" aria-live="polite">
      <div className="rb-head">
        <HeadIcon run={run} />
        <div className="rb-title">
          <strong>{phaseTitle(run)}</strong>
          <span className="faint"> · {run.serverName}</span>
        </div>
        {took !== null && (
          <span className="rb-time mono" title={active ? "Tiempo desde que se pidió el reinicio" : "Lo que tardó en volver"}>
            {formatElapsed(took)}
          </span>
        )}
        {!active && (
          <button className="icon-btn" onClick={() => dismissReboot(run.key)} title="Cerrar" aria-label="Cerrar">
            <X size={14} />
          </button>
        )}
      </div>
      <ol className="rb-steps">
        {STEPS.map((label, i) => (
          <li key={label} className={`rb-step rb-step-${steps[i]}`}>
            <StepIcon s={steps[i]} /> {label}
          </li>
        ))}
      </ol>
      <div className="rb-detail">{phaseDetail(run)}</div>
      {(active || run.canReconnect) && (
        <div className="rb-actions">
          {run.canReconnect && (
            <button className="btn btn-sm btn-primary" onClick={() => void reconnectAfterReboot(run.key)}>
              <RotateCw size={13} /> Reconectar
            </button>
          )}
          {active && (
            <button className="btn btn-sm" onClick={() => void stopWaiting(run.key)} title="Las pestañas que no hayan vuelto quedan con «Reconectar»">
              Dejar de esperar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function RebootHost() {
  const runs = useReboots((s) => s.runs);
  const list = Object.values(runs);
  if (list.length === 0) return null;
  return (
    <div className="rb-host">
      {list.map((r) => (
        <RebootCard key={r.key} run={r} />
      ))}
    </div>
  );
}
