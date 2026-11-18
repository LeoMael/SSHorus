// Diálogo «Nuevo servidor / Editar servidor», ligado a useUi().serverEditor. El formulario está en serverEditor/.
import { useUi } from "../stores/ui";
import { ServerEditor } from "./serverEditor/ServerEditor";

export function ServerEditorHost() {
  const editor = useUi((s) => s.serverEditor);
  const close = useUi((s) => s.closeServerEditor);
  if (!editor) return null;
  return (
    <ServerEditor
      key={`${editor.server?.id || "new"}:${editor.projectId ?? ""}`}
      initial={editor.server}
      fromProjectId={editor.projectId ?? null}
      onSaved={editor.onSaved}
      onClose={close}
    />
  );
}
