// Avisos de arriba de «Vulnerabilidades»: sin sudo o con la contraseña rechazada, y las fases del
// análisis mientras corre (o por qué no terminó).
import { KeyRound, ShieldAlert } from "lucide-react";
import { useVulnScan } from "../../../features/vulnscan";
import { storedFailed, sudoModeOf, useStoredSudoState } from "../../../features/privileges";
import { useAdmin } from "../context";
import { PhaseIcon } from "./VulnsTable";

export function VulnsSudoBanner() {
  const { sessionId, profileId, disabled, elevation, elev, askSudo } = useAdmin();
  const run = useVulnScan((s) => s.runs[sessionId]);
  const storedSudo = useStoredSudoState(sessionId);
  if (disabled || elevation) return null;

  if (run?.sudoRejected || storedFailed(storedSudo)) {
    return (
      <div className="adm-banner adm-banner-warn" role="alert">
        <ShieldAlert size={14} />
        <span className="adm-banner-text">
          {storedFailed(storedSudo)
            ? sudoModeOf(profileId) === "login"
              ? "La contraseña de la conexión no sirve para sudo."
              : "La contraseña de sudo guardada no funcionó."
            : "sudo rechazó la contraseña."}{" "}
          {run?.sudoRejected ? "El análisis siguió sin sudo: no se ven los contenedores de otros usuarios ni los de root." : ""}
        </span>
        {elev.canAskSudo && (
          <button className="btn btn-sm" onClick={askSudo}>
            <KeyRound size={13} /> Escribir otra contraseña
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="adm-banner adm-banner-warn" role="status">
      <ShieldAlert size={14} />
      <span className="adm-banner-text">
        Sin sudo se analizan el sistema y tus contenedores; no se ven los contenedores de otros usuarios ni los de root.
      </span>
      {elev.canAskSudo && (
        <button className="btn btn-sm" onClick={askSudo}>
          <KeyRound size={13} /> Analizar con sudo
        </button>
      )}
    </div>
  );
}

export function VulnScanPhases({ sessionId }: { sessionId: string }) {
  const run = useVulnScan((s) => s.runs[sessionId]);
  const running = !!run?.running;
  if (!run || !(running || run.error || run.canceled)) return null;
  return (
    <div className="vs-phases" role="status" aria-live="polite">
      <ul>
        {run.phases.map((p) => (
          <li key={p.id} className={`vs-ph vs-ph-${p.status}`}>
            <PhaseIcon p={p} />
            <span>{p.label}</span>
            {p.detail && <span className="faint">· {p.detail}</span>}
          </li>
        ))}
      </ul>
      <div className="vs-ph-progress">{running ? run.progress : run.canceled ? "Análisis cancelado." : `No se pudo terminar: ${run.error}`}</div>
    </div>
  );
}
