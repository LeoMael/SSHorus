// Piezas de estado de «Actualizar imagen»: comandos a revisar, contenedores ya reemplazados y el final
// (progreso del nuevo análisis, resultado, error y botón de sudo).
import { AlertTriangle, Check, KeyRound, Loader2 } from "lucide-react";
import { rescanMessage, type RescanResult } from "../../../features/vulnscan";

export function ImageUpdateCommands({ howText, shown, full }: { howText: string; shown: string[]; full: string }) {
  return (
    <>
      <div className="ct-review-label">{howText}</div>
      <pre className="ct-cmd" aria-label="Comandos que se ejecutarán">
        {shown.join("\n")}
      </pre>
      <details className="ct-details">
        <summary>Script completo enviado al servidor</summary>
        <pre className="ct-cmd ct-cmd-sm">{full}</pre>
      </details>
    </>
  );
}

export function ImageUpdateReplaced({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <ul className="vs-up-steps" aria-live="polite">
      {names.map((n) => (
        <li key={n} className="vs-ph-ok">
          <div className="vs-up-step">
            <Check size={13} /> <span>Reemplazado: {n}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ImageUpdateOutcome({
  rescanning,
  progress,
  result,
  error,
  needSudo,
  onAskSudo,
}: {
  rescanning: boolean;
  progress: string;
  /** Solo se enseña al terminar. */
  result: RescanResult | null;
  error: string | null;
  needSudo: boolean;
  onAskSudo: () => void;
}) {
  return (
    <>
      {rescanning && (
        <div className="vs-up-progress">
          <Loader2 size={14} className="adm-spin" /> {progress}
        </div>
      )}
      {result && (
        <div className={result.remaining > 0 ? "ct-warn" : "vs-up-ok"} role="status">
          {rescanMessage(result.remaining)}
        </div>
      )}
      {error && (
        <div className="ct-error" role="alert">
          <AlertTriangle size={14} />
          <pre>{error}</pre>
        </div>
      )}
      {needSudo && (
        <button className="btn btn-sm" onClick={onAskSudo}>
          <KeyRound size={13} /> Introducir contraseña de sudo
        </button>
      )}
    </>
  );
}
