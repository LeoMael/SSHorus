// «Auditar proyecto»: audita todos los servidores del proyecto (3 a la vez, en segundo plano) y compara sus
// notas y los problemas que más se repiten. Sin auditar de nuevo enseña el último informe de cada uno.
import { useMemo } from "react";
import { ClipboardCheck, ListChecks, Square } from "lucide-react";
import {
  PROJECT_AUDIT_CONCURRENCY,
  closeProjectAudit,
  commonProblems,
  grade,
  projectSummary,
  startProjectAudit,
  useProjectAudit,
  type ProjectAuditTarget,
} from "../../features/audit";
import { cancelJob } from "../../features/jobs";
import { openJobCenter } from "../../stores/jobs";
import { AdmModal } from "../ui/AdmModal";
import { GradeBadge, ProjectAuditRow } from "./ProjectAuditRow";
import { useProjectAuditData } from "./useProjectAuditData";
import "../Admin/audit/Audit.css";
import "./ProjectAudit.css";

export function ProjectAuditDialog({ projectId }: { projectId: string }) {
  const { project, items, loading } = useProjectAuditData(projectId);
  const jobId = useProjectAudit((s) => s.jobs[projectId]);
  const running = !!jobId;
  const sum = useMemo(() => projectSummary(items), [items]);
  const common = useMemo(() => commonProblems(items), [items]);
  const name = project?.name ?? "Proyecto";

  const start = (targets: ProjectAuditTarget[]) => {
    if (targets.length) startProjectAudit({ projectId, projectName: name, targets });
  };
  const all = () => start(items.map((i) => ({ profileId: i.profileId, name: i.name })));

  return (
    <AdmModal title={`Auditar proyecto · ${name}`} onClose={closeProjectAudit} width="min(820px, 94vw)" className="pa-modal">
      <div className="modal-body pa-body">
        <div className="pa-top">
          <GradeBadge grade={sum.average !== null ? grade(sum.average) : null} score={sum.average} />
          <div className="pa-top-text">
            <div className="pa-top-score">
              {sum.average !== null ? (
                <>
                  Media {sum.average}
                  <span className="faint">/100</span>
                </>
              ) : (
                "Sin auditar"
              )}
            </div>
            <div className="faint">
              {sum.audited} de {sum.total} con informe
              {sum.worst && ` · peor: ${sum.worst.name} (${sum.worst.score})`}
              {sum.noSudo > 0 && ` · ${sum.noSudo} sin sudo`}
            </div>
          </div>
          <span className="pa-spacer" />
          {running ? (
            <>
              <button className="btn btn-sm" onClick={() => openJobCenter({ jobId })} title="Ver la tarea en segundo plano">
                <ListChecks size={13} /> Ver tarea
              </button>
              <button className="btn btn-sm" onClick={() => void cancelJob(jobId)} title="No empieza más servidores y corta las conexiones propias">
                <Square size={12} /> Cancelar
              </button>
            </>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={all} disabled={items.length === 0} title={`Revisa cada servidor sin instalar nada (${PROJECT_AUDIT_CONCURRENCY} a la vez)`}>
              <ClipboardCheck size={13} /> Auditar {items.length === 1 ? "el servidor" : `los ${items.length} servidores`}
            </button>
          )}
        </div>
        <div className="pa-hint faint">
          Usa la pestaña abierta o conecta aparte con lo guardado. Sin contraseña guardada se salta el servidor; sin sudo
          se audita igual y queda marcado. Puedes cerrar esta ventana: sigue en segundo plano.
        </div>

        <div className="section-label">Servidores</div>
        <div className="pa-list">
          {loading && items.length > 0 ? (
            <div className="empty-state">
              <span className="spinner" />
            </div>
          ) : items.length === 0 ? (
            <div className="empty-state">Este proyecto no tiene servidores.</div>
          ) : (
            items.map((it) => <ProjectAuditRow key={it.profileId} item={it} canRun={!running} onAudit={() => start([{ profileId: it.profileId, name: it.name }])} />)
          )}
        </div>

        {common.length > 0 && (
          <>
            <div className="section-label">Lo que más se repite</div>
            <div className="pa-common">
              {common.map((p) => (
                <div key={p.id} className={`pa-common-row au-${p.status}`}>
                  <span className="pa-common-count" title={p.servers.join(", ")}>
                    {p.servers.length}/{sum.audited}
                  </span>
                  <span className="au-title">{p.title}</span>
                  <span className="au-detail">{p.servers.join(", ")}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </AdmModal>
  );
}
