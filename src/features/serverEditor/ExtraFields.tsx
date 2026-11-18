// Opciones del final del formulario: carpeta inicial, tmux, color y (si no va arriba) proyecto.
import type { Project, TmuxMode } from "../../api/types";
import { useSettings } from "../../stores/settings";
import { ColorPicker } from "../ColorPicker";
import { TMUX_MODE_HINTS, TMUX_MODE_LABELS } from "../tmux/logic";
import { ProjectSelect } from "./ProjectFields";
import type { ServerFormFields } from "./serverForm";
import type { SetFields } from "./useServerForm";

export function ExtraFields({
  fields,
  set,
  projects,
  showProject,
}: {
  fields: ServerFormFields;
  set: SetFields;
  projects: readonly Project[];
  showProject: boolean;
}) {
  const globalTmux = useSettings((s) => s.settings.terminalTmux);
  const { tmux } = fields;
  return (
    <>
      <div className="cd-cols">
        <label className="field">
          <span>Carpeta inicial (opcional)</span>
          <input
            className="input mono"
            value={fields.defaultPath}
            spellCheck={false}
            placeholder="Carpeta personal del usuario"
            onChange={(e) => set({ defaultPath: e.target.value })}
          />
        </label>

        <label className="field">
          <span>Terminales persistentes (tmux)</span>
          <select
            className="select"
            value={tmux ?? ""}
            onChange={(e) => set({ tmux: e.target.value === "" ? null : (e.target.value as TmuxMode) })}
          >
            <option value="">Como en Ajustes ({TMUX_MODE_LABELS[globalTmux]})</option>
            <option value="auto">{TMUX_MODE_LABELS.auto}: si el servidor tiene tmux</option>
            <option value="always">{TMUX_MODE_LABELS.always}: avisar si falta tmux</option>
            <option value="never">{TMUX_MODE_LABELS.never}</option>
          </select>
          <small className="cd-field-hint">{TMUX_MODE_HINTS[tmux ?? globalTmux]}</small>
        </label>
      </div>

      <div className="cd-cols">
        <div className="field">
          <span>Color</span>
          <ColorPicker value={fields.color} onChange={(c) => set({ color: c })} />
        </div>
        {showProject && (
          <label className="field">
            <span>Proyecto</span>
            <ProjectSelect projects={projects} value={fields.projectId} onChange={(id) => set({ projectId: id })} onTop={false} />
          </label>
        )}
      </div>
    </>
  );
}
