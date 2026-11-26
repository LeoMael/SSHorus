// Una fila de «Permisos por servidor» (Ajustes → Asistentes de IA): nivel de acceso, «Solo lo marcado»,
// usuarios protegidos, «Aceptar automáticamente» (si alguien tiene ahí Completo o Solo lo marcado: la conexión
// con token o un asistente conectado) y reglas «Permitir siempre».
import { useState } from "react";
import { Trash2, X } from "lucide-react";
import { mcp, type McpAccess, type McpAutoState, type McpConfig } from "../../api/mcp";
import type { ServerProfile } from "../../api/types";
import { toast } from "../../stores/toasts";
import { refreshAuto, useMcp } from "../../features/mcp/store";
import { autoAllowed } from "../../features/mcp/pairing";
import { ACCESS, accessOf, allowsAuto, grantsOf, protectedOf, tasksText } from "../../features/mcp/accessInfo";
import { AutoAcceptPicker, autoText } from "../../features/mcp/AutoAccept";
import { MarkedEditor } from "../../features/mcp/MarkedEditor";
import { PROTECTED_NOTE, ProtectedInput } from "../../features/mcp/ProtectedUsers";

type Panel = "marked" | "protected" | "auto" | "rules" | null;

/** «run_command\nuptime» → «run_command: uptime». */
function ruleLabel(key: string): string {
  const [tool, ...rest] = key.split("\n");
  return rest.length ? `${tool}: ${rest.join(" · ")}` : tool;
}

interface Props {
  server: ServerProfile;
  cfg: McpConfig | null;
  onChange: (cfg: McpConfig) => void;
  auto: McpAutoState | undefined;
  now: number;
}

export function McpServerRow({ server: s, cfg, onChange, auto, now }: Props) {
  const [open, setOpen] = useState<Panel>(null);
  const access = accessOf(cfg, s.id);
  const rules = cfg?.remembered[s.id] ?? [];
  const own = cfg?.protectedUsers?.[s.id] ?? [];
  const prot = protectedOf(cfg, s.id);
  const canAuto = autoAllowed(s.id, access, useMcp((st) => st.paired));
  const toggle = (p: Panel) => setOpen(open === p ? null : p);

  const setAccess = async (next: McpAccess) => {
    try {
      onChange(await mcp.setAccess(s.id, next));
      if (!allowsAuto(next)) void refreshAuto();
      if (next === "custom") setOpen("marked");
    } catch (e) {
      toast.error("No se pudo guardar el permiso", e);
    }
  };

  const saveProtected = async (users: string[]) => {
    try {
      onChange(await mcp.applyRules([s.id], { protected: users }));
      return true;
    } catch (e) {
      toast.error("No se pudo guardar la lista", e);
      return false;
    }
  };

  const forget = async (key: string | null) => {
    try {
      onChange(await mcp.forgetRule(s.id, key));
    } catch (e) {
      toast.error("No se pudo quitar la regla", e);
    }
  };

  return (
    <div className="mcp-server">
      <div className="mcp-server-row">
        <div className="mcp-server-name">
          <span>{s.name}</span>
          <small className="faint">
            {s.username}@{s.host}
          </small>
          {access === "custom" && <small className="faint">Puede: {tasksText(grantsOf(cfg, s.id))}</small>}
          {prot.length > 0 && access !== "none" && <small className="faint">Protegidos: {prot.join(", ")}</small>}
          {auto && canAuto && (
            <small className={auto.level === "all" ? "mcp-auto-state all" : "mcp-auto-state"}>Automático: {autoText(auto, now)}</small>
          )}
        </div>
        {access === "custom" && (
          <button className="btn btn-sm" onClick={() => toggle("marked")} aria-expanded={open === "marked"}>
            Lo marcado…
          </button>
        )}
        {access !== "none" && (
          <button
            className="btn btn-sm"
            onClick={() => toggle("protected")}
            aria-expanded={open === "protected"}
            title="Usuarios del servidor que la IA no puede tocar"
          >
            {own.length ? `Protegidos (${own.length})` : "Protegidos…"}
          </button>
        )}
        {canAuto && (
          <button
            className="btn btn-sm"
            onClick={() => toggle("auto")}
            title={
              "Deja de pedir permiso durante un tiempo (nunca con SSHorus bloqueado). Cada acción queda marcada como «automático»." +
              (access === "custom" ? " Solo dentro de lo marcado." : "")
            }
          >
            {auto ? "Automático (activo)" : "Automático…"}
          </button>
        )}
        {rules.length > 0 && (
          <button className="btn btn-sm" onClick={() => toggle("rules")}>
            {rules.length === 1 ? "1 regla «siempre»" : `${rules.length} reglas «siempre»`}
          </button>
        )}
        <div className="st-segmented" role="radiogroup" aria-label={`Acceso a ${s.name}`}>
          {ACCESS.map((o) => (
            <button
              key={o.v}
              role="radio"
              aria-checked={access === o.v}
              className={access === o.v ? `active mcp-acc-${o.v}` : ""}
              title={o.title}
              onClick={() => void setAccess(o.v)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {open === "marked" && access === "custom" && <MarkedEditor serverId={s.id} cfg={cfg} onChange={onChange} />}
      {open === "protected" && access !== "none" && (
        <div className="mcp-marked">
          <ProtectedInput value={own} onSave={saveProtected} label={`Usuarios protegidos en ${s.name}`} />
          <small className="faint">Además de los de todos los servidores. {PROTECTED_NOTE}</small>
        </div>
      )}
      {open === "auto" && canAuto && <AutoAcceptPicker serverId={s.id} serverName={s.name} onApplied={() => setOpen(null)} />}
      {open === "rules" && rules.length > 0 && (
        <div className="mcp-rules">
          {rules.map((k) => (
            <div key={k} className="mcp-rule">
              <code title={k}>{ruleLabel(k)}</code>
              <button className="icon-btn" onClick={() => void forget(k)} title="Quitar regla" aria-label="Quitar regla">
                <X size={14} />
              </button>
            </div>
          ))}
          <button className="btn btn-sm" onClick={() => void forget(null)}>
            <Trash2 size={12} /> Quitar todas
          </button>
        </div>
      )}
    </div>
  );
}
