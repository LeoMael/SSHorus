// «Tareas» en la cabecera de Contenedores: cuántas tareas largas hay en marcha en esta conexión y su
// lista (con la salida de la elegida).
import { useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import { useCtJobs } from "../../features/containers/jobs";
import { AdmModal } from "../ui/AdmModal";
import { JobStatusIcon, JobView, jobTiming, useNow } from "./JobView";
import "./ComposeJobs.css";

export function JobsButton({ sessionId }: { sessionId: string }) {
  const all = useCtJobs((s) => s.jobs);
  const jobs = useMemo(() => all.filter((j) => j.sessionId === sessionId), [all, sessionId]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const running = jobs.filter((j) => j.status === "running").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const now = useNow(open && running > 0);
  if (jobs.length === 0) return null;
  const shown = jobs.find((j) => j.id === sel) ?? jobs[0];

  return (
    <>
      <button
        className="btn btn-sm ct-jobs-btn"
        onClick={() => setOpen(true)}
        title="Tareas largas en segundo plano (Compose, descargar imágenes)"
        aria-label={`Tareas: ${running} en marcha`}
      >
        {running > 0 ? <span className="spinner ct-spinner-xs" /> : <ListChecks size={13} />}
        Tareas{running > 0 ? ` (${running} en marcha)` : failed > 0 ? ` (${failed} con error)` : ""}
      </button>
      {open && (
        <AdmModal title="Tareas en segundo plano" onClose={() => setOpen(false)} width="min(860px, 94vw)">
          <div className="modal-body">
            <div className="faint ct-small ct-mb-6">Siguen aunque cierres esta ventana o cambies de pestaña. Al terminar verás un aviso.</div>
            <ul className="ct-jobs-list" role="listbox" aria-label="Tareas">
              {jobs.map((j) => (
                <li key={j.id} role="option" aria-selected={j.id === shown.id} className={j.id === shown.id ? "on" : undefined} onClick={() => setSel(j.id)}>
                  <JobStatusIcon status={j.status} />
                  <strong className="ct-ellipsis">{j.title}</strong>
                  <span className="faint ct-ellipsis">{j.detail}</span>
                  <span className="ct-grow" />
                  <span className="faint">{jobTiming(j, now).elapsed}</span>
                </li>
              ))}
            </ul>
            <JobView key={shown.id} job={shown} onClose={() => setSel(null)} />
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setOpen(false)}>
              Cerrar
            </button>
          </div>
        </AdmModal>
      )}
    </>
  );
}
