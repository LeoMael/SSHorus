// Poner o quitar el registro de visitas de un sitio: explica qué se hará, enseña el script exacto y
// lo lanza como tarea en segundo plano (features/admin/webLogJob.ts) con sus pasos en vivo y «Cancelar».
// Se puede cerrar el diálogo: la tarea sigue en la esquina de abajo a la derecha.
import { useState } from "react";
import { FileMinus2, FilePlus2, KeyRound, RotateCw } from "lucide-react";
import { LOG_BACKUP_DIR, startWebLog, WEBLOG_JOB, type ServerInfo, type Site, type SiteLogPlan } from "../../features/admin";
import { useJobs } from "../../stores/jobs";
import { JobPanel } from "../Jobs/JobPanel";
import { AdmModal } from "../ui/AdmModal";
import { useAdmin } from "./context";
import { elevationText } from "./PlanReview";
import "./WebTraffic.css";

interface Props {
  server: ServerInfo;
  site: Site;
  plan: SiteLogPlan;
  onClose: () => void;
  /** Al terminar bien (aunque el diálogo ya esté cerrado): vuelve a leer Sitios web. */
  onChanged: () => void;
}

function What({ server, site, plan }: Pick<Props, "server" | "site" | "plan">) {
  const check = server.server === "caddy" ? "caddy validate" : "nginx -t";
  if (plan.action === "disable") {
    return (
      <p className="dialog-message">
        Se quita del sitio el registro que puso SSHorus y vuelve lo que había antes (por ejemplo «access_log off;»). Antes se
        guarda una copia en <code className="mono">{LOG_BACKUP_DIR}</code>, se valida con <code>{check}</code> y se recarga sin
        cortar conexiones. El archivo <code className="mono">{plan.logPath}</code> no se borra.
      </p>
    );
  }
  return (
    <>
      <p className="dialog-message">
        {site.server === "caddy"
          ? "Se añade al bloque del sitio un registro en formato JSON con rotación automática (5 archivos de 10 MB, 30 días) en "
          : "Se añade «access_log … combined;» al bloque server {} del sitio (logrotate lo rota con el resto de /var/log/nginx) en "}
        <code className="mono">{plan.logPath}</code>.
        {site.server === "nginx" && site.accessLog?.shared && " Si el sitio usaba el registro común (heredado de http {}), sus visitas pasan a ir a este."}
      </p>
      <p className="dialog-message faint">
        Antes se guarda una copia en <code className="mono">{LOG_BACKUP_DIR}</code>, se valida con <code>{check}</code> y se
        recarga sin cortar conexiones; si algo falla, el archivo vuelve a quedar como estaba. Se prepara la carpeta (dueño y,
        con SELinux, contexto httpd_log_t) y al final se hace una visita de prueba para ver que se registra.
      </p>
    </>
  );
}

export function WebLogDialog({ server, site, plan, onClose, onChanged }: Props) {
  const { sessionId, profileId, serverName, elevation, askSudo, disabled } = useAdmin();
  const key = `${WEBLOG_JOB}|${site.key}`;
  const [jobId, setJobId] = useState<string | null>(null);
  // Si ya hay una tarea en marcha para este sitio (lanzada antes de cerrar el diálogo), se sigue esa.
  const job = useJobs((s) => s.jobs.find((j) => (jobId ? j.id === jobId : j.key === key && j.status === "running")) ?? null);
  const enable = plan.action === "enable";

  const start = () => {
    if (!elevation) return askSudo();
    setJobId(
      startWebLog({
        sessionId,
        profileId,
        serverName,
        elevation,
        server: server.server,
        siteKey: site.key,
        plan,
        onFinished: (j) => j.status === "done" && onChanged(),
      }),
    );
  };

  return (
    <AdmModal title={plan.title} onClose={onClose} width={job ? 760 : 660}>
      <div className="modal-body adm-review">
        {job ? (
          <>
            {job.status === "running" && (
              <p className="faint">Puedes cerrar esta ventana: sigue en segundo plano. Si cancelas antes de recargar, el archivo queda como estaba.</p>
            )}
            <JobPanel job={job} compact />
          </>
        ) : (
          <>
            <What server={server} site={site} plan={plan} />
            <ol className="wt-steps">
              {plan.steps.map((s) => (
                <li key={s.key}>{s.label}</li>
              ))}
            </ol>
            <details className="adm-details">
              <summary>{elevationText(elevation)} (script completo)</summary>
              <pre className="adm-cmd adm-cmd-sm">{plan.script}</pre>
            </details>
          </>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={onClose}>
          {job ? "Cerrar" : "Cancelar"}
        </button>
        {(!job || job.status === "failed" || job.status === "canceled") && (
          <button className="btn btn-primary" onClick={start} disabled={disabled} autoFocus>
            {!elevation ? <KeyRound size={14} /> : job ? <RotateCw size={14} /> : enable ? <FilePlus2 size={14} /> : <FileMinus2 size={14} />}
            {!elevation ? "Conectar con sudo" : job ? "Reintentar" : enable ? "Activar registro" : "Quitar registro"}
          </button>
        )}
      </div>
    </AdmModal>
  );
}
