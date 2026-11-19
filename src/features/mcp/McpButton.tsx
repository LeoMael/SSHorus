// Botón del asistente en la barra de pestañas (solo con el MCP encendido): abre «Actividad del
// asistente». Un punto avisa si algo espera tu permiso o se está ejecutando.
// Al lado, mientras algún servidor esté en «Aceptar automáticamente», un indicador: un clic abre la
// lista de lo activo para apagarlo por servidor o todo (nunca se apaga a ciegas).
import { useState } from "react";
import { Bot, Zap } from "lucide-react";
import { activeAuto, openActivity, useMcp } from "./store";
import { autoText, useMinuteClock } from "./AutoAccept";
import { AutoActivePanel } from "./AutoActivePanel";
import "./Mcp.css";

function AutoIndicator() {
  const now = useMinuteClock();
  const auto = useMcp((s) => s.auto);
  const [open, setOpen] = useState(false);
  const list = activeAuto(auto, now);
  if (list.length === 0 && !open) return null;
  const all = list.some((a) => a.level === "all");
  const count = list.length === 1 ? "1 servidor" : `${list.length} servidores`;
  const detail = list.map((a) => `${a.serverName}: ${autoText(a, now)}`).join("\n");
  const label = `Aceptar automáticamente activo en ${count}: clic para ver`;
  return (
    <>
      {list.length > 0 && (
        <button
          className={all ? "btn btn-sm mcp-auto-ind all" : "btn btn-sm mcp-auto-ind"}
          title={`${label}\n${detail}`}
          aria-label={label}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <Zap size={12} /> Automático
        </button>
      )}
      {open && <AutoActivePanel list={list} now={now} onClose={() => setOpen(false)} />}
    </>
  );
}

export function McpButton() {
  const enabled = useMcp((s) => !!s.status?.enabled);
  const waiting = useMcp((s) => s.approvals.length > 0);
  const running = useMcp((s) => s.activity.some((a) => a.status === "running"));
  if (!enabled) return null;
  const hint = waiting ? " (espera tu permiso)" : running ? " (trabajando)" : "";
  return (
    <>
      <AutoIndicator />
      <button
        className="icon-btn tabs-side-btn mcp-btn"
        title={`Actividad del asistente${hint}`}
        aria-label={`Actividad del asistente${hint}`}
        onClick={openActivity}
      >
        <Bot size={16} />
        {(waiting || running) && <span className={waiting ? "mcp-btn-dot waiting" : "mcp-btn-dot"} />}
      </button>
    </>
  );
}
