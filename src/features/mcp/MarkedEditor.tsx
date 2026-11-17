// «Solo lo marcado» de un servidor: plantillas, casillas por tarea, carpetas para «Archivos» y «Comandos libres».
// Las reglas se aplican en el motor (mcp/grants.rs); aquí solo se editan y se guardan.
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { mcp, type McpConfig, type McpGrants, type McpTask, type McpTemplate } from "../../api/mcp";
import { toast } from "../../stores/toasts";
import { cleanFolder, grantsOf, matchingTemplate, TASKS, TEMPLATES } from "./accessInfo";
import "./Mcp.css";

interface Props {
  serverId: string;
  cfg: McpConfig | null;
  onChange: (cfg: McpConfig) => void;
}

export function MarkedEditor({ serverId, cfg, onChange }: Props) {
  const g = grantsOf(cfg, serverId);
  const [folder, setFolder] = useState("");
  const current = matchingTemplate(g);

  const save = async (rules: { grants?: McpGrants; template?: McpTemplate }) => {
    try {
      onChange(await mcp.applyRules([serverId], rules));
    } catch (e) {
      toast.error("No se pudo guardar el permiso", e);
    }
  };
  const setGrants = (next: Partial<McpGrants>) => void save({ grants: { ...g, ...next } });
  const toggle = (t: McpTask) => setGrants({ tasks: g.tasks.includes(t) ? g.tasks.filter((x) => x !== t) : [...g.tasks, t] });

  const addFolder = () => {
    const f = cleanFolder(folder);
    if (!f) {
      toast.error("Carpeta no válida", "Escribe una ruta absoluta del servidor, p. ej. /srv/www");
      return;
    }
    setFolder("");
    if (!g.folders.includes(f)) setGrants({ folders: [...g.folders, f] });
  };

  return (
    <div className="mcp-marked">
      <div className="mcp-marked-templates" role="group" aria-label="Plantillas">
        <span className="faint">Plantilla:</span>
        {TEMPLATES.map((t) => (
          <button
            key={t.v}
            className={current === t.v ? "btn btn-sm active" : "btn btn-sm"}
            aria-pressed={current === t.v}
            onClick={() => void save({ template: t.v })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mcp-marked-tasks">
        {TASKS.map((t) => (
          <label key={t.v} className="mcp-check" title={t.hint}>
            <input type="checkbox" checked={g.tasks.includes(t.v)} onChange={() => toggle(t.v)} />
            <span>{t.label}</span>
          </label>
        ))}
      </div>

      {g.tasks.includes("files") && (
        <div className="mcp-folders">
          {g.folders.length === 0 && <small className="faint">Sin carpetas: no podrá escribir en ninguna.</small>}
          {g.folders.map((f) => (
            <span key={f} className="mcp-chip">
              <code>{f}</code>
              <button className="icon-btn" aria-label={`Quitar ${f}`} title="Quitar" onClick={() => setGrants({ folders: g.folders.filter((x) => x !== f) })}>
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            className="input mcp-folder-input"
            placeholder="/srv/www"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addFolder()}
            aria-label="Carpeta permitida"
          />
          <button className="btn btn-sm" onClick={addFolder} disabled={!folder.trim()}>
            <Plus size={12} /> Carpeta
          </button>
        </div>
      )}

      <label className="mcp-check mcp-free">
        <input type="checkbox" checked={g.freeCommands} onChange={() => setGrants({ freeCommands: !g.freeCommands })} />
        <span>Comandos libres</span>
      </label>
      <small className={g.freeCommands ? "mcp-warn-line" : "faint"}>
        Con comandos libres la IA puede ejecutar cualquier comando y las casillas ya no limitan.
      </small>
    </div>
  );
}
