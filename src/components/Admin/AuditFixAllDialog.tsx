// «Arreglar todo lo seguro»: aplica de una vez los arreglos que no pueden dejarte fuera (los peligrosos,
// como desactivar la contraseña o activar el cortafuegos, van aparte con su propia comprobación previa).
// Enseña cada comando antes, avanza uno a uno (cancelable) y al final vuelve a comprobar todo lo tocado.
import { CircleDashed, Play, ShieldAlert } from "lucide-react";
import type { AuditReport, Check } from "../../api/audit";
import type { RecheckOutcome } from "../../features/audit";
import { AdmModal } from "../ui/AdmModal";
import { FixFooter, NeedSudo, OutcomeLine } from "./AuditFixParts";
import { useAdmin } from "./context";
import { elevationText } from "./PlanReview";
import { useAuditFix } from "./useAuditFix";

export function AuditFixAllDialog({
  report,
  safe,
  risky,
  onClose,
  onUpdated,
}: {
  report: AuditReport;
  /** Arreglos seguros, en orden de importancia. */
  safe: Check[];
  /** Los que van aparte (pueden cortar el acceso o un servicio). */
  risky: Check[];
  onClose: () => void;
  onUpdated: (r: AuditReport, outcomes: RecheckOutcome[]) => void;
}) {
  const { elevation, disabled } = useAdmin();
  const fx = useAuditFix(onUpdated);

  return (
    <AdmModal title={`Arreglar todo lo seguro (${safe.length})`} onClose={fx.phase === "running" ? () => undefined : onClose} width={680}>
      <div className="modal-body adm-review">
        <div className="faint">Estos arreglos no cortan tu acceso. Se aplican uno tras otro y después se vuelve a comprobar.</div>
        <NeedSudo />
        <div className="adm-review-label">{elevationText(elevation)}</div>
        <ol className="au-fx-list">
          {safe.map((c) => {
            const r = fx.results[c.id];
            return (
              <li key={c.id}>
                <details>
                  <summary>
                    <span className="au-fx-name">{c.title}</span>
                    {fx.phase === "running" && !r && <CircleDashed size={13} className="faint" />}
                    <OutcomeLine result={r} outcome={fx.outcomes[c.id]} />
                  </summary>
                  <pre className="adm-cmd adm-cmd-sm">{c.fix?.command}</pre>
                  {r?.output && <pre className={r.ok ? "adm-cmd adm-cmd-sm au-fx-out" : "adm-cmd adm-cmd-sm au-fx-out au-fx-out-bad"}>{r.output}</pre>}
                </details>
              </li>
            );
          })}
        </ol>
        {risky.length > 0 && (
          <div className="adm-banner adm-banner-warn">
            <ShieldAlert size={14} />
            <span className="adm-banner-text">
              Van aparte, con su botón «Arreglar» y una comprobación previa: {risky.map((c) => c.title).join(" · ")}.
            </span>
          </div>
        )}
        {fx.recheckError && <div className="faint">{fx.recheckError}</div>}
      </div>
      <FixFooter phase={fx.phase} executing={fx.executing} onCancel={fx.cancel} onClose={onClose}>
        {fx.phase === "idle" && (
          <button className="btn btn-primary" onClick={() => void fx.start(report, safe)} disabled={!elevation || disabled || !safe.length} autoFocus>
            <Play size={13} /> Arreglar {safe.length}
          </button>
        )}
      </FixFooter>
    </AdmModal>
  );
}
