// Un túnel guardado: interruptor, ruta, estado en vivo y acciones.
import { ArrowDown, ArrowUp, Copy, Pencil, Trash2, TriangleAlert } from "lucide-react";
import type { TunnelDef, TunnelStatus } from "../../api/tunnels";
import { formatBytes } from "../../lib/format";
import { isTunnelOn, KIND_INFO, tunnelAddress } from "../../features/tunnels/useTunnels";

function routeText(def: TunnelDef, st?: TunnelStatus) {
  const addr = tunnelAddress(def, st);
  if (def.kind === "socks") return { from: "Tu PC", fromAddr: addr, to: "SOCKS5", toAddr: "sale por el servidor" };
  if (def.kind === "remote")
    return { from: "Servidor", fromAddr: addr, to: "Tu PC", toAddr: `${def.destHost}:${def.destPort}` };
  return { from: "Tu PC", fromAddr: addr, to: "Servidor", toAddr: `${def.destHost}:${def.destPort}` };
}

const STATE_LABEL: Record<TunnelStatus["state"], string> = {
  starting: "Activando…",
  active: "Activo",
  waiting: "Esperando conexión",
  stopped: "Parado",
  error: "Error",
};

export interface TunnelRowProps {
  def: TunnelDef;
  st: TunnelStatus | undefined;
  pending: boolean;
  disabled: boolean;
  start: (def: TunnelDef) => Promise<void>;
  stop: (def: TunnelDef) => Promise<void>;
  copy: (def: TunnelDef) => Promise<void>;
  onEdit: (def: TunnelDef) => void;
  remove: (def: TunnelDef) => Promise<void>;
}

export function TunnelRow({ def, st, pending, disabled, start, stop, copy, onEdit, remove }: TunnelRowProps) {
  const on = isTunnelOn(st);
  const state = st?.state ?? "stopped";
  const route = routeText(def, st);
  return (
    <li className={`tn-row tn-state-${state}`}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={on ? `Desactivar ${def.name}` : `Activar ${def.name}`}
        title={disabled ? "Conéctate para activar" : on ? "Desactivar" : "Activar"}
        className={on ? "tn-switch on" : "tn-switch"}
        disabled={pending || (disabled && !on)}
        onClick={() => void (on ? stop(def) : start(def))}
      >
        <span />
      </button>
      <div className="tn-main">
        <div className="tn-line">
          <span className={`status-dot tn-dot tn-dot-${state}`} title={STATE_LABEL[state]} />
          <span className="tn-name" title={def.name}>
            {def.name}
          </span>
          <span className={`tn-kind tn-kind-${def.kind}`} title={KIND_INFO[def.kind].help}>
            {KIND_INFO[def.kind].label}
          </span>
          {def.autoStart && (
            <span className="tn-auto" title="Se activa solo al conectar">
              auto
            </span>
          )}
          {(pending || state === "starting") && <span className="spinner tn-spinner" />}
        </div>
        <div className="tn-route">
          <span className="faint">{route.from}</span> <span className="mono">{route.fromAddr}</span>
          <span className="tn-arrow">→</span>
          <span className="faint">{route.to}</span> <span className="mono">{route.toAddr}</span>
        </div>
        {on && st && (
          <div className="tn-stats">
            <span>
              {st.connections === 1 ? "1 conexión" : `${st.connections} conexiones`}
            </span>
            <span title="De tu PC hacia el servidor">
              <ArrowUp size={12} /> {formatBytes(st.bytesUp)}
            </span>
            <span title="Del servidor hacia tu PC">
              <ArrowDown size={12} /> {formatBytes(st.bytesDown)}
            </span>
          </div>
        )}
        {st?.message && (
          <div className={state === "error" ? "tn-msg tn-msg-error" : "tn-msg tn-msg-wait"}>{st.message}</div>
        )}
        {on && st?.lastError && !st.message && (
          <div className="tn-msg tn-msg-warn" title="Último fallo de una conexión">
            <TriangleAlert size={12} /> {st.lastError}
          </div>
        )}
      </div>
      <div className="tn-actions">
        <button className="icon-btn" title={`Copiar ${route.fromAddr}`} onClick={() => void copy(def)}>
          <Copy size={14} />
        </button>
        <button className="icon-btn" title="Editar" onClick={() => onEdit(def)}>
          <Pencil size={14} />
        </button>
        <button className="icon-btn tn-danger" title="Borrar" onClick={() => void remove(def)}>
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}
