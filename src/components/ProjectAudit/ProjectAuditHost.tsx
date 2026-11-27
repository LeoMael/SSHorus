// Monta «Auditar proyecto» cuando está abierto y la comparación del aviso de la auditoría programada («Ver»);
// los dos se cargan al usarse. App lo monta una vez: <ProjectAuditHost />.
// Para abrirlos: openProjectAudit(projectId) de features/audit/projectStore y openAuditChanges(…) de
// features/audit/scheduleStore.
import { Suspense } from "react";
import { useProjectAudit } from "../../features/audit/projectStore";
import { useAuditSchedule } from "../../features/audit/scheduleStore";
import { preloadable } from "../../lib/lazy";

const ProjectAuditDialog = preloadable(() => import("./ProjectAuditDialog").then((m) => m.ProjectAuditDialog));
const AuditChangesDialog = preloadable(() => import("./AuditChangesDialog").then((m) => m.AuditChangesDialog));

export function ProjectAuditHost() {
  const open = useProjectAudit((s) => s.open);
  const changes = useAuditSchedule((s) => s.changes);
  if (!open && !changes) return null;
  return (
    <Suspense fallback={null}>
      {open && <ProjectAuditDialog key={open} projectId={open} />}
      {changes && <AuditChangesDialog changes={changes} />}
    </Suspense>
  );
}
