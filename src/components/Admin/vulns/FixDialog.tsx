// «Arreglar»: muestra el comando exacto (uno solo para todos los paquetes elegidos), pide confirmación y
// lo lanza como tarea en segundo plano (features/vulnscan/fixJob.ts): como root con la contraseña de
// sudo guardada, salida en vivo, «Cancelar» y vuelta a comprobar. Se puede cerrar el diálogo: la tarea
// sigue en la esquina de abajo a la derecha.
import { useMemo, useState } from "react";
import { KeyRound, Wrench } from "lucide-react";
import type { Finding, Report } from "../../../api/vulnscan";
import { wrapScript } from "../../../features/privileges";
import { packageChoices, startVulnFix, upgradeCommand } from "../../../features/vulnscan";
import { useJobs } from "../../../stores/jobs";
import { useSettings } from "../../../stores/settings";
import { JobPanel } from "../../Jobs/JobPanel";
import { AdmModal } from "../../ui/AdmModal";
import { useAdmin } from "../context";
import { SevTag } from "./vulnUi";
import { VulnFixJobView } from "./VulnFixJobView";
import "../../Containers/Containers.css";
import "../../Containers/ContainersBars.css";
import "../../Containers/ContainersTable.css";
import "../../Containers/ContainersReview.css";
import "../../Containers/ContainersForm.css";
import "../../Containers/ContainersCleanup.css";
import "./VulnFix.css";

export function FixDialog({ report, findings, onClose }: { report: Report; findings: Finding[]; onClose: () => void }) {
  const { sessionId, elevation, info, askSudo, disabled } = useAdmin();
  const settings = useSettings((s) => s.settings.vulnscan);
  const choices = useMemo(() => packageChoices(findings), [findings]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(choices.map((c) => c.name)));
  const chosen = choices.filter((c) => picked.has(c.name));
  const command = upgradeCommand(report, chosen.flatMap((c) => c.binaries));
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobs((s) => (jobId ? (s.jobs.find((j) => j.id === jobId) ?? null) : null));
  const running = job?.status === "running";

  const toggle = (name: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  const start = () => {
    if (!command || !elevation) return;
    setJobId(
      startVulnFix({
        sessionId,
        report,
        scope: chosen.flatMap((c) => c.findings),
        command,
        packages: chosen.map((c) => c.name),
        el: elevation,
        settings,
        view: VulnFixJobView,
        actions: (d) => (d.needSudo ? [{ label: "Introducir contraseña de sudo", run: askSudo }] : []),
      }),
    );
  };

  const howText = elevation?.kind === "root" || info?.level === "root" ? "Se ejecutará como root:" : "Se ejecutará como root con tu contraseña de sudo guardada:";

  return (
    <AdmModal title="Arreglar vulnerabilidades" onClose={onClose} width={job ? 760 : 680}>
      <div className="modal-body vf-dialog">
        {!elevation && !job && (
          <div className="ct-warn">
            Hace falta sudo para actualizar paquetes.{" "}
            <button className="btn btn-sm" onClick={askSudo}>
              <KeyRound size={13} /> Introducir contraseña de sudo
            </button>
          </div>
        )}

        {job ? (
          <>
            {running && <p className="vs-d-note faint">Puedes cerrar esta ventana: sigue en segundo plano y verás un aviso al terminar. Cancelar a mitad puede dejar la actualización a medias.</p>}
            <JobPanel job={job} compact />
          </>
        ) : (
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
      </div>

      <div className="modal-footer">
        {job ? (
          <button className="btn btn-primary" onClick={onClose}>
            {running ? "Cerrar (sigue en segundo plano)" : "Cerrar"}
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={start} disabled={!command || !elevation || disabled} autoFocus>
              <Wrench size={13} /> Arreglar
            </button>
          </>
        )}
      </div>
    </AdmModal>
  );
}
