// Un cambio del panel «Configuración»: qué hace, el comando exacto y cómo se eleva, la comprobación previa
// de la Auditoría si puede dejarte fuera (llave instalada, no entrar como root), confirmación escrita si
// es peligroso y, al ejecutar, la tarea en segundo plano con su salida en vivo.
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Play, ShieldAlert } from "lucide-react";
import { errorMessage } from "../../../api/core";
import type { Check } from "../../../api/audit";
import { guardOkText, guardProblem, needsGuard, readGuard } from "../../../features/audit";
import { elevationText } from "../../../features/privileges";
import { startConfigChange, type ConfigChange } from "../../../features/serverConfig";
import { useJobs } from "../../../stores/jobs";
import { AdmModal } from "../../ui/AdmModal";
import { JobPanel } from "../../Jobs/JobPanel";
import { FixFooter, NeedSudo } from "../audit/AuditFixParts";
import type { FixPhase } from "../audit/useAuditFix";
import { useAdmin } from "../context";

const CONFIRM_WORD = "CAMBIAR";

type Guard = { state: "checking" } | { state: "ok"; text: string | null } | { state: "blocked"; text: string };

/** Comprobación previa (sin sudo) de los arreglos de SSH que pueden dejarte fuera. */
function useGuard(check: Check | null): Guard | null {
  const { sessionId, profileId } = useAdmin();
  const needed = !!check && needsGuard(check);
  const [guard, setGuard] = useState<Guard | null>(needed ? { state: "checking" } : null);
  useEffect(() => {
    if (!check || !needsGuard(check)) return;
    let alive = true;
    readGuard(sessionId, profileId)
      .then((g) => {
        if (!alive) return;
        const problem = guardProblem(check, g);
        setGuard(problem ? { state: "blocked", text: problem } : { state: "ok", text: guardOkText(check, g) });
      })
      .catch((e) => alive && setGuard({ state: "blocked", text: `No se pudo comprobar antes: ${errorMessage(e)}` }));
    return () => {
      alive = false;
    };
  }, [check, sessionId, profileId]);
  return guard;
}

export function ConfigChangeDialog({ change, onClose }: { change: ConfigChange; onClose: () => void }) {
  const { sessionId, profileId, serverName, elevation, disabled, askSudo } = useAdmin();
  const guard = useGuard(change.guardCheck);
  const [typed, setTyped] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobs((s) => (jobId ? (s.jobs.find((j) => j.id === jobId) ?? null) : null));
  const phase: FixPhase = !job ? "idle" : job.status === "running" ? "running" : "done";
  const blocked = !elevation || disabled || phase === "running" || guard?.state === "checking" || guard?.state === "blocked" || (change.danger && typed !== CONFIRM_WORD);

  const run = () => {
    if (!elevation) return;
    setJobId(
      startConfigChange({
        sessionId,
        profileId,
        serverName,
        elevation,
        change,
        actions: (d) => (d.needSudo ? [{ label: "Introducir contraseña de sudo", run: askSudo }] : []),
      }),
    );
  };

  return (
    <AdmModal title={change.title} onClose={onClose} width={620}>
      <div className="modal-body adm-review">
        <div>{change.explain}</div>
        {change.note && (
          <div className={change.danger ? "adm-banner adm-banner-warn" : "faint"}>
            {change.danger && <ShieldAlert size={14} />} {change.note}
          </div>
        )}
        {guard?.state === "checking" && (
          <div className="faint">
            <span className="spinner adm-spinner-btn" /> Comprobando que no te quedas fuera…
          </div>
        )}
        {guard?.state === "blocked" && (
          <div className="adm-error" role="alert">
            <AlertTriangle size={14} />
            <pre>{guard.text}</pre>
          </div>
        )}
        {guard?.state === "ok" && guard.text && (
          <div className="au-fx-line au-fx-ok">
            <CheckCircle2 size={13} /> {guard.text}
          </div>
        )}
        <NeedSudo />
        <div className="adm-review-label">{elevationText(elevation)}</div>
        <pre className="adm-cmd" aria-label="Comandos que se ejecutarán">
          {change.steps.join("\n")}
        </pre>
        {change.danger && phase === "idle" && guard?.state !== "blocked" && (
          <label className="field adm-confirm-word">
            <span>
              Puede cortar el acceso o un servicio. Para confirmar, escribe <strong className="mono">{CONFIRM_WORD}</strong>
            </span>
            <input className="input mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
        )}
        {job && <JobPanel job={job} compact />}
      </div>
      <FixFooter phase={phase} onClose={onClose}>
        {phase !== "running" && !(phase === "done" && job?.status === "done") && (
          <button className={change.danger ? "btn btn-danger" : "btn btn-primary"} onClick={run} disabled={blocked} autoFocus={!change.danger}>
            <Play size={13} /> {phase === "done" ? "Reintentar" : "Ejecutar"}
          </button>
        )}
      </FixFooter>
    </AdmModal>
  );
}
