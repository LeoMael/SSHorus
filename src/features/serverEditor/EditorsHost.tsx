// Editores de servidor y de proyecto (se abren con useUi). Se cargan al abrirse: no hacen falta para la
// primera pantalla. App los monta justo antes de ConnectDialogHost, para que la huella de «Probar
// conexión» se vea encima del editor.
import { Suspense } from "react";
import { preloadable } from "../../lib/lazy";
import { useUi } from "../../stores/ui";

export const ServerEditorHost = preloadable(() => import("./ServerEditorHost").then((m) => m.ServerEditorHost));
export const ProjectEditorHost = preloadable(() => import("../profiles/ProjectEditor").then((m) => m.ProjectEditorHost));

export function EditorsHost() {
  const serverEditorOpen = useUi((s) => s.serverEditor !== null);
  const projectEditorOpen = useUi((s) => s.projectEditor !== null);
  if (!serverEditorOpen && !projectEditorOpen) return null;
  return (
    <Suspense fallback={null}>
      {serverEditorOpen && <ServerEditorHost />}
      {projectEditorOpen && <ProjectEditorHost />}
    </Suspense>
  );
}
