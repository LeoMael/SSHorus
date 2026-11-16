// Resultado de «Arreglar»: arreglado / siguen (y por qué), servicios a reiniciar y aviso de reinicio.
import { useState } from "react";
import { Check, RotateCcw, TriangleAlert } from "lucide-react";
import { errorMessage } from "../../api/core";
import type { Report } from "../../api/vulnscan";
import { byReason, crossSummary, restartService, STAY_TEXT, type CrossResult, type RestartInfo } from "../../features/vulnscan";
import type { Elevation } from "../../features/privileges";
import { toast } from "../../stores/toasts";
import { confirmDialog } from "../ui/dialogs";
import { CommandActions } from "./vulnUi";

function ServiceRow({ sessionId, unit, el }: { sessionId: string; unit: string; el: Elevation | null }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const restart = async () => {
    if (!el) return;
    const yes = await confirmDialog({
      title: `¿Reiniciar ${unit}?`,
      message: <code className="mono">systemctl restart {unit}</code>,
      confirmText: "Reiniciar",
    });
    if (!yes) return;
    setState("busy");
    try {
      await restartService(sessionId, unit, el);
      setState("done");
      toast.success("Servicio reiniciado", unit);
    } catch (e) {
      setState("idle");
      toast.error(`No se pudo reiniciar ${unit}`, errorMessage(e));
    }
  };
  return (
    <li>
      <span className="mono">{unit}</span>
      {state === "done" ? (
        <span className="vf-ok">
          <Check size={12} /> reiniciado
        </span>
      ) : (
        <button className="btn btn-sm" onClick={() => void restart()} disabled={!el || state === "busy"}>
          <RotateCcw size={12} /> {state === "busy" ? "Reiniciando…" : "Reiniciar"}
        </button>
      )}
    </li>
  );
}

export function FixResult({
  sessionId,
  result,
  restart,
  report,
  el,
  sudoTool,
}: {
  sessionId: string;
  result: CrossResult;
  restart: RestartInfo | null;
  report: Report;
  el: Elevation | null;
  sudoTool: string;
}) {
  const groups = byReason(result.remaining);
  const reboot = !report.host.inContainer && (restart?.reboot || report.host.rebootRequired);
  return (
    <div className="vf-result">
      <div className={`vf-result-head ${result.remaining.length ? "warn" : "ok"}`} role="status">
        {result.remaining.length ? <TriangleAlert size={14} /> : <Check size={14} />} {crossSummary(result)}
      </div>
      {groups.length > 0 && (
        <ul className="vf-reasons">
          {groups.map((g) => (
            <li key={g.reason}>
              <strong>{g.count}</strong> · {STAY_TEXT[g.reason]}
              <span className="faint mono"> ({g.packages.slice(0, 6).join(", ")}{g.packages.length > 6 ? "…" : ""})</span>
            </li>
          ))}
        </ul>
      )}
      {restart && restart.services.length > 0 && (
        <section className="vf-services">
          <h4>Servicios que siguen con la versión vieja</h4>
          <ul>
            {restart.services.map((u) => (
              <ServiceRow key={u} sessionId={sessionId} unit={u} el={el} />
            ))}
          </ul>
        </section>
      )}
      {restart && restart.tool === null && result.fixed.length > 0 && (
        <p className="vs-d-note faint">No se sabe qué servicios usan aún la versión vieja (falta needrestart o needs-restarting): si dudas, reinicia el servidor.</p>
      )}
      {reboot && (
        <div className="vf-reboot-box">
          <RotateCcw size={14} /> Reinicia el servidor para terminar.
          <CommandActions sessionId={sessionId} text={`${sudoTool ? `${sudoTool} ` : ""}reboot`} />
        </div>
      )}
    </div>
  );
}
