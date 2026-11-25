// «Tareas» en la cabecera de Contenedores: cuántas tareas largas de esta conexión hay en marcha; abre el
// centro de tareas de la app con solo las de Contenedores de esta conexión.
import { useMemo } from "react";
import { ListChecks } from "lucide-react";
import { jobCounts } from "../../features/jobs";
import { CT_JOB_KIND } from "../../features/containers/jobs";
import { openJobCenter, useJobs } from "../../stores/jobs";
import { useTabs } from "../../stores/tabs";

export function JobsButton({ sessionId }: { sessionId: string }) {
  const server = useTabs((s) => s.tabs.find((t) => t.sessionId === sessionId)?.title ?? "");
  const all = useJobs((s) => s.jobs);
  const jobs = useMemo(() => all.filter((j) => j.kind === CT_JOB_KIND && j.sessionId === sessionId), [all, sessionId]);
  if (jobs.length === 0) return null;
  const { running, failed } = jobCounts(jobs);
  return (
    <button
      className="btn btn-sm"
      onClick={() => openJobCenter({ filter: { label: `Contenedores de ${server || "este servidor"}`, kind: CT_JOB_KIND, sessionId } })}
      title="Tareas largas en segundo plano (Compose, descargar imágenes)"
      aria-label={`Tareas: ${running} en marcha`}
    >
      {running > 0 ? <span className="spinner ct-spinner-xs" /> : <ListChecks size={13} />}
      Tareas{running > 0 ? ` (${running} en marcha)` : failed > 0 ? ` (${failed} con error)` : ""}
    </button>
  );
}
