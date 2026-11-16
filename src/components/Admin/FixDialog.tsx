// «Arreglar»: muestra el comando exacto (uno solo para todos los paquetes elegidos), pide confirmación,
// lo ejecuta como root con la contraseña de sudo guardada (salida en vivo, «Cancelar») y vuelve a
// comprobar el sistema: lo arreglado sale del informe y del historial.
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, KeyRound, Loader2, Square, Wrench } from "lucide-react";
import { errorMessage } from "../../api/core";
import type { Finding, Report } from "../../api/vulnscan";
import { ElevationError, failureText } from "../../features/admin/run";
import { wrapScript } from "../../features/privileges";
import {
  checkRestart,
  crossReports,
  crossSummary,
  packageChoices,
  recheckSystem,
  runFix,
  UpdateCancel,
  UpdateCanceled,
  upgradeCommand,
  useVulnScan,
  type CrossResult,
  type RestartInfo,
} from "../../features/vulnscan";
import { useSettings } from "../../stores/settings";
import { toast } from "../../stores/toasts";
import { AdmModal } from "./AdmModal";
import { useAdmin } from "./context";
import { FixResult } from "./FixResult";
import { SevTag, sudoToolOf } from "./vulnUi";
import "../Containers/Containers.css";
import "./VulnFix.css";

type Stage = "review" | "running" | "checking" | "done";

/** Se guarda solo el final de la salida (una actualización grande escribe mucho). */
const MAX_OUTPUT = 200_000;

export function FixDialog({ report, findings, onClose }: { report: Report; findings: Finding[]; onClose: () => void }) {
  const { sessionId, elevation, info, askSudo, disabled } = useAdmin();
  const settings = useSettings((s) => s.settings.vulnscan);
  const choices = useMemo(() => packageChoices(findings), [findings]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(choices.map((c) => c.name)));
  const chosen = choices.filter((c) => picked.has(c.name));
  const command = upgradeCommand(report, chosen.flatMap((c) => c.binaries));
  const tool = sudoToolOf(info, elevation);

  const [stage, setStage] = useState<Stage>("review");
  const [output, setOutput] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needSudo, setNeedSudo] = useState(false);
  const [result, setResult] = useState<CrossResult | null>(null);
  const [restart, setRestart] = useState<RestartInfo | null>(null);
  const [after, setAfter] = useState<Report | null>(null);
  const cancel = useRef(new UpdateCancel());
  const outRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  const toggle = (name: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  const start = async () => {
    if (!command || !elevation) return;
    const scope = chosen.flatMap((c) => c.findings);
    const c = new UpdateCancel();
    cancel.current = c;
    setStage("running");
    setOutput("");
    setError(null);
    setNeedSudo(false);
    try {
      const r = await runFix(sessionId, command, elevation, c, (t) => setOutput((o) => (o + t).slice(-MAX_OUTPUT)));
      // Aunque falle, se comprueba igual: puede que parte se haya actualizado.
      if (r.exitCode !== 0 || r.timedOut) setError(failureText(r));
      setStage("checking");
      setProgress("Buscando servicios que reiniciar…");
      try {
        setRestart(await checkRestart(sessionId, elevation, c));
      } catch (e) {
        if (e instanceof UpdateCanceled) throw e;
      }
      const next = await recheckSystem({ sessionId, report, settings, cancel: c, onProgress: setProgress });
      useVulnScan.getState().setReport(sessionId, next);
      const x = crossReports(scope, next);
      setAfter(next);
      setResult(x);
      if (x.remaining.length) toast.info("Actualización terminada", crossSummary(x));
      else toast.success("Actualización terminada", crossSummary(x));
    } catch (e) {
      if (e instanceof UpdateCanceled) setError("Cancelado. Puede que la actualización haya quedado a medias: pulsa «Volver a comprobar».");
      else {
        setError(e instanceof ElevationError ? e.message : errorMessage(e));
        setNeedSudo(e instanceof ElevationError && (e.failure === "need-password" || e.failure === "bad-password"));
      }
    } finally {
      setStage("done");
    }
  };

  const busy = stage === "running" || stage === "checking";
  const close = () => {
    if (!busy) onClose();
  };
  const howText = elevation?.kind === "root" || info?.level === "root" ? "Se ejecutará como root:" : "Se ejecutará como root con tu contraseña de sudo guardada:";

  return (
    <AdmModal title="Arreglar vulnerabilidades" onClose={close} width={680}>
      <div className="modal-body vf-dialog">
        {!elevation && (
          <div className="ct-warn">
            Hace falta sudo para actualizar paquetes.{" "}
            <button className="btn btn-sm" onClick={askSudo}>
              <KeyRound size={13} /> Introducir contraseña de sudo
            </button>
          </div>
        )}

        {stage === "review" && (
          <>
            <ul className="vf-pkgs" aria-label="Paquetes que se actualizan">
              {choices.map((c) => (
                <li key={c.name}>
                  <label className="checkbox">
                    <input type="checkbox" checked={picked.has(c.name)} onChange={() => toggle(c.name)} disabled={!c.binaries.length} />
                    <SevTag s={c.worst} /> <span className="mono">{c.name}</span>
                  </label>
                  <span className="faint">
                    {c.findings.length} {c.findings.length === 1 ? "vulnerabilidad" : "vulnerabilidades"}
                    {c.kernel ? " · luego hay que reiniciar" : ""}
                  </span>
                </li>
              ))}
            </ul>
            {command ? (
              <>
                <div className="ct-review-label">{howText}</div>
                <pre className="ct-cmd" aria-label="Comando que se ejecutará">
                  {command}
                </pre>
                {elevation && (
                  <details className="ct-details">
                    <summary>Script completo enviado al servidor</summary>
                    <pre className="ct-cmd ct-cmd-sm">{wrapScript(command, elevation)}</pre>
                  </details>
                )}
              </>
            ) : (
              <p className="vs-d-note">Elige al menos un paquete.</p>
            )}
          </>
        )}

        {stage !== "review" && (
          <pre ref={outRef} className="ct-cmd ct-cmd-sm vf-output" aria-live="polite" aria-label="Salida del comando">
            {output || (stage === "running" ? "Esperando la salida del servidor…" : "")}
          </pre>
        )}
        {stage === "running" && <p className="vs-d-note faint">Cancelar a mitad puede dejar la actualización a medias.</p>}
        {stage === "checking" && (
          <div className="vf-progress" role="status">
            <Loader2 size={13} className="adm-spin" /> {progress}
          </div>
        )}

        {error && (
          <div className="ct-error" role="alert">
            <AlertTriangle size={14} />
            <pre>{error}</pre>
          </div>
        )}
        {needSudo && (
          <button className="btn btn-sm" onClick={askSudo}>
            <KeyRound size={13} /> Introducir contraseña de sudo
          </button>
        )}
        {stage === "done" && result && after && (
          <FixResult sessionId={sessionId} result={result} restart={restart} report={after} el={elevation} sudoTool={tool} />
        )}
      </div>

      <div className="modal-footer">
        {busy ? (
          <button className="btn" onClick={() => void cancel.current.cancel()}>
            <Square size={13} /> Cancelar
          </button>
        ) : stage === "review" ? (
          <>
            <button className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={() => void start()} disabled={!command || !elevation || disabled} autoFocus>
              <Wrench size={13} /> Arreglar
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={onClose}>
            Cerrar
          </button>
        )}
      </div>
    </AdmModal>
  );
}
