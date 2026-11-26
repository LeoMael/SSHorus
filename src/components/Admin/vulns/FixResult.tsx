// Resultado de «Arreglar», paquete por paquete (arreglado / falta reiniciar / sin versión corregida en tus
// repos / falló con la línea de dnf), servicios a reiniciar y aviso de reinicio.
import { useState } from "react";
import { Check, RotateCcw, TriangleAlert } from "lucide-react";
import { errorMessage } from "../../../api/core";
import type { Report } from "../../../api/vulnscan";
import { byReason, crossSummary, OUTCOME_TEXT, outcomeSummary, restartService, STAY_TEXT, type CrossResult, type PackageOutcome, type RestartInfo } from "../../../features/vulnscan";
import type { Elevation } from "../../../features/privileges";
import { toast } from "../../../stores/toasts";
import { confirmDialog } from "../../ui/dialogs";
import { RebootButton } from "../../../features/reboot";

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

const GOOD = new Set<PackageOutcome["status"]>(["fixed", "restart", "reboot"]);

function Outcomes({ list }: { list: PackageOutcome[] }) {
  return (
    <ul className="vf-outcomes" aria-label="Resultado por paquete">
      {list.map((o) => (
        <li key={o.package} className={GOOD.has(o.status) ? "ok" : "warn"}>
          <span className="mono">{o.package}</span>
          <strong>{OUTCOME_TEXT[o.status]}</strong>
          {o.total > 1 && o.fixed > 0 && o.fixed < o.total && <span className="faint">({o.fixed} de {o.total})</span>}
          {o.detail && <div className={`vf-outcome-detail${o.status === "failed" ? " mono" : ""}`}>{o.detail}</div>}
        </li>
      ))}
    </ul>
  );
}

export function FixResult({
  sessionId,
  result,
  outcomes,
  restart,
  report,
  el,
}: {
  sessionId: string;
  result: CrossResult;
  /** Una fila por paquete (tareas de antes de esta versión: null, se usa `result`). */
  outcomes: PackageOutcome[] | null;
  restart: RestartInfo | null;
  report: Report;
  el: Elevation | null;
}) {
  const groups = outcomes ? [] : byReason(result.remaining);
  const reboot = !report.host.inContainer && (restart?.reboot || report.host.rebootRequired);
  const allGood = outcomes ? outcomes.every((o) => GOOD.has(o.status)) : !result.remaining.length;
  return (
    <div className="vf-result">
      <div className={`vf-result-head ${allGood ? "ok" : "warn"}`} role="status">
        {allGood ? <Check size={14} /> : <TriangleAlert size={14} />} {outcomes ? outcomeSummary(outcomes) : crossSummary(result)}
      </div>
      {outcomes && <Outcomes list={outcomes} />}
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
      {outcomes?.some((o) => o.status === "norepo") && (
        <p className="vs-d-note faint">«Sin versión corregida en tus repos»: la distro ya publicó el arreglo, pero tus repositorios todavía no lo traen. Vuelve a comprobar en unos días (el detalle de cada vulnerabilidad dice por qué sigue).</p>
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
          <RebootButton sessionId={sessionId} />
        </div>
      )}
    </div>
  );
}
