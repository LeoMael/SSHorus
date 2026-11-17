// Ajustes del asistente para varios servidores a la vez: elegir servidores (o un proyecto entero) y aplicar
// un nivel, una plantilla de «Solo lo marcado» y, si se quiere, la misma lista de usuarios protegidos.
import { useState } from "react";
import { mcp, type McpAccess, type McpConfig, type McpRules, type McpTemplate } from "../../api/mcp";
import { useProfiles } from "../../stores/profiles";
import { toast } from "../../stores/toasts";
import { ACCESS, nameError, parseNames, TEMPLATES } from "./accessInfo";
import "./Mcp.css";

export function McpBulk({ onChange }: { onChange: (cfg: McpConfig) => void }) {
  const servers = useProfiles((s) => s.servers);
  const projects = useProfiles((s) => s.projects);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [access, setAccess] = useState<McpAccess | "keep">("keep");
  const [template, setTemplate] = useState<McpTemplate | "keep">("deploy");
  const [protectedText, setProtectedText] = useState("");
  const [setProtected, setSetProtected] = useState(false);
  const [busy, setBusy] = useState(false);

  if (servers.length < 2) return null;

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pickProject = (id: string) => {
    const p = projects.find((x) => x.id === id);
    if (p) setChosen(new Set(p.serverIds.filter((s) => servers.some((x) => x.id === s))));
  };

  const rules = (): McpRules | null => {
    const r: McpRules = {};
    if (access !== "keep") r.access = access;
    if (access === "custom" && template !== "keep") r.template = template;
    if (setProtected) {
      const names = parseNames(protectedText);
      const bad = names.map(nameError).find(Boolean);
      if (bad) {
        toast.error("Nombre no válido", bad);
        return null;
      }
      r.protected = names;
    }
    return Object.keys(r).length ? r : null;
  };

  const apply = async () => {
    const r = rules();
    if (!r) {
      toast.error("Nada que aplicar", "Elige un nivel o marca «Usuarios protegidos».");
      return;
    }
    setBusy(true);
    try {
      onChange(await mcp.applyRules([...chosen], r));
      toast.success(chosen.size === 1 ? "Aplicado a 1 servidor" : `Aplicado a ${chosen.size} servidores`);
    } catch (e) {
      toast.error("No se pudo aplicar", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mcp-bulk">
      <div className="mcp-bulk-row">
        <span className="faint">Servidores:</span>
        {projects.length > 0 && (
          <select className="input mcp-bulk-select" value="" onChange={(e) => pickProject(e.target.value)} aria-label="Elegir un proyecto">
            <option value="">Todo un proyecto…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-sm" onClick={() => setChosen(new Set(servers.map((s) => s.id)))}>
          Todos
        </button>
        <button className="btn btn-sm" onClick={() => setChosen(new Set())} disabled={chosen.size === 0}>
          Ninguno
        </button>
      </div>
      <div className="mcp-marked-tasks">
        {servers.map((s) => (
          <label key={s.id} className="mcp-check" title={`${s.username}@${s.host}`}>
            <input type="checkbox" checked={chosen.has(s.id)} onChange={() => toggle(s.id)} />
            <span>{s.name}</span>
          </label>
        ))}
      </div>
      <div className="mcp-bulk-row">
        <span className="faint">Nivel:</span>
        <select className="input mcp-bulk-select" value={access} onChange={(e) => setAccess(e.target.value as McpAccess | "keep")} aria-label="Nivel">
          <option value="keep">No cambiar</option>
          {ACCESS.map((a) => (
            <option key={a.v} value={a.v}>
              {a.label}
            </option>
          ))}
        </select>
        {access === "custom" && (
          <select className="input mcp-bulk-select" value={template} onChange={(e) => setTemplate(e.target.value as McpTemplate | "keep")} aria-label="Plantilla">
            <option value="keep">Mantener las casillas de cada uno</option>
            {TEMPLATES.map((t) => (
              <option key={t.v} value={t.v}>
                Plantilla: {t.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="mcp-bulk-row">
        <label className="mcp-check">
          <input type="checkbox" checked={setProtected} onChange={() => setSetProtected((v) => !v)} />
          <span>Usuarios protegidos</span>
        </label>
        <input
          className="input"
          placeholder="ana, deploy (reemplaza la lista de cada servidor)"
          value={protectedText}
          disabled={!setProtected}
          onChange={(e) => setProtectedText(e.target.value)}
          aria-label="Usuarios protegidos para los servidores elegidos"
        />
      </div>
      <div className="mcp-bulk-row">
        <button className="btn btn-primary btn-sm" onClick={() => void apply()} disabled={busy || chosen.size === 0}>
          Aplicar a {chosen.size === 1 ? "1 servidor" : `${chosen.size} servidores`}
        </button>
      </div>
    </div>
  );
}
