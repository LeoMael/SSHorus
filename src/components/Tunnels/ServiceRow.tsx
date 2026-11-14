// Una fila de «Servicios que puedes traer»: qué es, dónde está en el servidor, cómo se verá en tu PC y el
// botón «Traer a mi PC» (o, ya traído, abrirlo o copiar cómo conectarse).
import { openUrl } from "@tauri-apps/plugin-opener";
import { Copy, ExternalLink, Square } from "lucide-react";
import type { TunnelDef, TunnelStatus } from "../../api/tunnels";
import { clipboard } from "../../lib/clipboard";
import { toast } from "../../stores/toasts";
import { categoryOf } from "../../features/tunnels/categories";
import { browserUrl, connectionString, serviceTitle, type FoundService } from "../../features/tunnels/detect";
import { isTunnelOn } from "../../features/tunnels/useTunnels";
import { CATEGORY_ICONS } from "./categoryIcons";

const SCOPE_TAG: Record<FoundService["scope"], { text: string; cls: string; help: string } | null> = {
  local: {
    text: "Solo dentro del servidor",
    cls: "tn-svc-tag-local",
    help: "Desde internet no se puede usar. Con el túnel, sí: desde tu PC y por SSH.",
  },
  public: {
    text: "Abierto a internet",
    cls: "tn-svc-tag-public",
    help: "Ya se puede usar desde fuera si el cortafuegos lo deja. Con el túnel va cifrado por SSH.",
  },
  ip: null,
};

function copy(text: string, what: string) {
  clipboard.write(text).then(
    () => toast.success(what, text),
    (e) => toast.error("No se pudo copiar", e),
  );
}

export interface ServiceRowProps {
  item: FoundService;
  /** Túnel guardado que ya va a este servicio. */
  def: TunnelDef | undefined;
  status: TunnelStatus | undefined;
  /** Puerto propuesto en tu PC (0 = uno libre al activarlo; undefined = calculando). */
  proposed: number | undefined;
  busy: boolean;
  disabled: boolean;
  onBring: () => void;
  onStop: (def: TunnelDef) => void;
}

export function ServiceRow({ item, def, status, proposed, busy, disabled, onBring, onStop }: ServiceRowProps) {
  const svc = item.service;
  const category = categoryOf(item);
  const Icon = CATEGORY_ICONS[category];
  const on = isTunnelOn(status);
  const localPort = on ? (status?.boundPort ?? def?.bindPort ?? 0) : (def?.bindPort ?? proposed ?? 0);
  const localAddr = localPort ? `localhost:${localPort}` : "un puerto libre";
  const conn = localPort ? connectionString(svc, localPort) : null;
  const url = on && localPort ? browserUrl(svc, item.port, localPort) : null;
  const tag = SCOPE_TAG[item.scope];
  const who = [...item.procs, ...(item.container ? [`contenedor ${item.container}`] : [])].join(", ");
  const title = serviceTitle(item);

  return (
    <li className={on ? "tn-svc on" : "tn-svc"}>
      <Icon size={16} className={`tn-svc-icon tn-cat-${category}`} />
      <div className="tn-svc-main">
        <div className="tn-line">
          <span className="tn-name" title={title}>
            {title}
          </span>
          {tag && (
            <span className={`tn-svc-tag ${tag.cls}`} title={tag.help}>
              {tag.text}
            </span>
          )}
        </div>
        <div className="tn-svc-where">
          <span className="faint">Servidor</span> <span className="mono">{`${item.destHost}:${item.port}`}</span>
          {who && <span className="faint"> · {who}</span>}
        </div>
        <div className="tn-svc-where">
          <span className="faint">{on ? "En tu PC" : "Aparecerá en tu PC como"}</span>{" "}
          <span className={on ? "mono tn-svc-live" : "mono"}>{localAddr}</span>
          {on && <span className="status-dot tn-dot tn-dot-active" title="Traído: ya lo puedes usar" />}
        </div>
        {conn && (
          <button className="tn-svc-conn mono" title="Copiar cadena de conexión" onClick={() => copy(conn, "Cadena de conexión copiada")}>
            <span>{conn}</span> <Copy size={12} />
          </button>
        )}
        {svc?.apps && <div className="tn-svc-apps faint">Ábrelo con {svc.apps}.</div>}
        {item.guessed && <div className="tn-svc-apps faint">No se sabe qué programa es, pero responde como una página web.</div>}
      </div>
      <div className="tn-svc-actions">
        {on && def ? (
          <>
            {url && (
              <button className="btn btn-sm btn-primary" onClick={() => void openUrl(url)}>
                <ExternalLink size={13} /> Abrir en el navegador
              </button>
            )}
            {!url && !conn && (
              <button className="btn btn-sm" onClick={() => copy(localAddr, "Dirección copiada")}>
                <Copy size={13} /> Copiar
              </button>
            )}
            <button className="icon-btn" title="Dejar de traerlo (parar el túnel)" disabled={busy} onClick={() => onStop(def)}>
              <Square size={13} />
            </button>
          </>
        ) : (
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || disabled}
            title={disabled ? "Conéctate para traerlo" : `Crear un túnel: ${item.destHost}:${item.port} → ${localAddr}`}
            onClick={onBring}
          >
            {busy ? <span className="spinner tn-spinner" /> : null} Traer a mi PC
          </button>
        )}
      </div>
    </li>
  );
}
