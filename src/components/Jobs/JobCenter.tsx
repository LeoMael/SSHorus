// Vista grande de las tareas en segundo plano: la lista (en marcha y las terminadas de esta sesión) y la
// tarea elegida entera (salida en vivo, pasos, tiempos, resultado, «Cancelar», «Copiar salida»).
import { useMemo } from "react";
import { X } from "lucide-react";
import { elapsedText, jobCounts, matchesFilter, statusLine } from "../../features/jobs";
import { clearJobHistory, closeJobCenter, selectJob, setJobFilter, useJobs } from "../../stores/jobs";
import { AdmModal } from "../ui/AdmModal";
import { JobStatusIcon, useNow } from "./JobBits";
import { JobPanel } from "./JobPanel";
import "./Jobs.css";

export function JobCenter() {
  const all = useJobs((s) => s.jobs);
  const filter = useJobs((s) => s.filter);
  const selected = useJobs((s) => s.selected);
  const jobs = useMemo(() => all.filter((j) => matchesFilter(j, filter)), [all, filter]);
  const c = jobCounts(all);
  const now = useNow(c.running > 0);
  const shown = jobs.find((j) => j.id === selected) ?? jobs[0] ?? null;

  return (
    <AdmModal title="Tareas en segundo plano" onClose={closeJobCenter} width="min(1040px, 95vw)" className="jb-center">
      <div className="modal-body jb-center-body">
        <nav className="jb-list" aria-label="Tareas">
          {filter && (
            <div className="jb-filter">
              <span className="jb-ellipsis">Solo: {filter.label}</span>
              <button className="icon-btn" onClick={() => setJobFilter(null)} title="Ver todas las tareas" aria-label="Ver todas las tareas">
                <X size={12} />
              </button>
            </div>
          )}
          {jobs.length === 0 ? (
            <div className="empty-state jb-empty">{filter ? "No hay tareas de esto." : "No hay tareas."}</div>
          ) : (
            <ul>
              {jobs.map((j) => (
                <li key={j.id}>
                  <button className={j.id === shown?.id ? "jb-item on" : "jb-item"} aria-current={j.id === shown?.id ? "true" : undefined} onClick={() => selectJob(j.id)}>
                    <JobStatusIcon status={j.status} />
                    <span className="jb-item-main">
                      <span className="jb-item-top">
                        <strong className="jb-ellipsis">{j.title}</strong>
                        <span className="faint mono">{elapsedText(j, now)}</span>
                      </span>
                      <span className="faint jb-ellipsis">{[j.server, j.detail].filter(Boolean).join(" · ")}</span>
                      <span className="faint jb-ellipsis jb-item-line">{statusLine(j)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <section className="jb-detail" aria-label="Tarea elegida">
          {shown ? <JobPanel key={shown.id} job={shown} /> : <div className="empty-state">Elige una tarea de la lista.</div>}
        </section>
      </div>
      <div className="modal-footer">
        <span className="faint jb-foot-note">Las tareas siguen aunque cierres esta ventana o el diálogo que las lanzó. Las terminadas se recuerdan hasta cerrar SSHorus.</span>
        {c.finished > 0 && (
          <button className="btn" onClick={clearJobHistory} title="Quita las terminadas (las que están en marcha siguen)">
            Vaciar historial
          </button>
        )}
        <button className="btn btn-primary" onClick={closeJobCenter}>
          Cerrar
        </button>
      </div>
    </AdmModal>
  );
}
