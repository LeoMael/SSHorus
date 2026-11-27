// Monta «Auditar proyecto» cuando está abierto (se carga al usarse). App lo monta una vez: <ProjectAuditHost />.
// Para abrirlo: openProjectAudit(projectId) de features/audit/projectStore.
import { Suspense } from "react";
import { useProjectAudit } from "../../features/audit/projectStore";
import { preloadable } from "../../lib/lazy";

const ProjectAuditDialog = preloadable(() => import("./ProjectAuditDialog").then((m) => m.ProjectAuditDialog));

export function ProjectAuditHost() {
  const open = useProjectAudit((s) => s.open);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <ProjectAuditDialog key={open} projectId={open} />
    </Suspense>
  );
}
