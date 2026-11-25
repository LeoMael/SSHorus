// Subcomponentes y ordenación de la tabla de contenedores (barra en lote y filas).
import type { KeyboardEvent, MouseEvent } from "react";
import { MoreHorizontal, Pause, Play, Power, RotateCw, ScrollText, Square, TerminalSquare, Trash2, X } from "lucide-react";
import {
  ago,
  execShellCmd,
  percent,
  portLabel,
  stateText,
  stateTone,
  statsFor,
  withOwner,
  type Container,
  type ContainerAction,
  type ContainerStats,
  type PortMapping,
} from "../../features/containers";
import { formatBytes } from "../../lib/format";
import { AutostartBadge, askAutostart } from "./Autostart";
import type { CtContextValue } from "./context";
import type { AutostartState } from "./useAutostart";

export type ContainerFilter = "all" | "running" | "stopped";
export type ContainerSortKey = "name" | "owner" | "image" | "state" | "autostart" | "created" | "cpu" | "mem";

/** Clave única de la fila (con «Todos», dos usuarios podrían repetir id o nombre). */
export const containerRowKey = (c: Container) => `${c.owner ?? ""}/${c.id}`;
export const isContainerUp = (c: Container) => c.state === "running" || c.state === "restarting";

export function filterAndSortContainers(
  list: Container[],
  opts: {
    filter: ContainerFilter;
    search: string;
    sort: { key: ContainerSortKey; dir: 1 | -1 };
    stats: ContainerStats[];
    allOwners: boolean;
    ownerLabel: (owner?: string) => string;
    autostartVerdict: (c: Container) => string | undefined;
  },
): Container[] {
  const s = opts.search.trim().toLowerCase();
  const out = list.filter((c) => {
    if (opts.filter === "running" && !isContainerUp(c)) return false;
    if (opts.filter === "stopped" && isContainerUp(c)) return false;
    if (!s) return true;
    return (
      (opts.allOwners && opts.ownerLabel(c.owner).toLowerCase().includes(s)) ||
      c.name.toLowerCase().includes(s) ||
      c.image.toLowerCase().includes(s) ||
      c.shortId.includes(s) ||
      (c.composeProject ?? "").toLowerCase().includes(s) ||
      c.ports.some((p) => String(p.hostPort ?? p.containerPort).includes(s))
    );
  });
  const val = (c: Container): string | number => {
    const st = statsFor(opts.stats, c);
    switch (opts.sort.key) {
      case "name":
        return c.name.toLowerCase();
      case "owner":
        return `${opts.ownerLabel(c.owner)} ${c.name.toLowerCase()}`;
      case "image":
        return c.image.toLowerCase();
      case "state":
        return `${c.state === "running" ? 0 : 1}${c.name.toLowerCase()}`;
      case "autostart": {
        const v = opts.autostartVerdict(c);
        const rank = v === "yes" ? 0 : v === "no" ? 1 : 2;
        return `${rank}${c.name.toLowerCase()}`;
      }
      case "created":
        return c.created ?? 0;
      case "cpu":
        return st?.cpuPercent ?? -1;
      case "mem":
        return st?.memUsage ?? -1;
    }
  };
  return out.sort((a, b) => {
    const x = val(a);
    const y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * opts.sort.dir;
  });
}

interface BatchBarProps {
  sel: Container[];
  ct: CtContextValue;
  auto: AutostartState;
  onDirect: (action: ContainerAction, cs: Container[]) => void;
  onConfirm: (action: "stop" | "restart", cs: Container[]) => void;
  onRemove: (cs: Container[]) => void;
  onClear: () => void;
}

export function ContainersBatchBar({ sel, ct, auto, onDirect, onConfirm, onRemove, onClear }: BatchBarProps) {
  return (
    <div className="ct-batch" role="toolbar" aria-label="Acciones sobre la selección">
      <strong>{sel.length} seleccionados</strong>
      <button
        className="btn btn-sm"
        onClick={() => onDirect("start", sel.filter((c) => !isContainerUp(c) && c.state !== "paused"))}
        disabled={!sel.some((c) => !isContainerUp(c) && c.state !== "paused")}
      >
        <Play size={13} /> Iniciar
      </button>
      <button className="btn btn-sm" onClick={() => onConfirm("stop", sel.filter(isContainerUp))} disabled={!sel.some(isContainerUp)}>
        <Square size={13} /> Parar
      </button>
      <button className="btn btn-sm" onClick={() => onConfirm("restart", sel)}>
        <RotateCw size={13} /> Reiniciar
      </button>
      <button
        className="btn btn-sm"
        onClick={() => onDirect("pause", sel.filter((c) => c.state === "running"))}
        disabled={!sel.some((c) => c.state === "running")}
      >
        <Pause size={13} /> Pausar
      </button>
      <button
        className="btn btn-sm"
        onClick={() => onDirect("unpause", sel.filter((c) => c.state === "paused"))}
        disabled={!sel.some((c) => c.state === "paused")}
      >
        <Play size={13} /> Reanudar
      </button>
      <button className="btn btn-sm" onClick={() => askAutostart(ct, auto, true, sel)} title="Que arranquen solos al reiniciar el servidor o si se caen">
        <Power size={13} /> Arranque solo
      </button>
      <button className="btn btn-sm ct-btn-danger" onClick={() => onRemove(sel)}>
        <Trash2 size={13} /> Eliminar
      </button>
      <span className="ct-grow" />
      <button className="icon-btn" onClick={onClear} title="Quitar selección" aria-label="Quitar selección">
        <X size={14} />
      </button>
    </div>
  );
}

interface RowProps {
  c: Container;
  ct: CtContextValue;
  auto: AutostartState;
  st: ContainerStats | undefined;
  selected: boolean;
  isBusy: boolean;
  onToggle: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => void;
  onContextMenu: (e: MouseEvent) => void;
  onLogs: () => void;
  onPortMenu: (e: MouseEvent, p: PortMapping) => void;
  onStop: () => void;
  onStart: () => void;
  onMore: (e: MouseEvent) => void;
}

export function ContainerRow({
  c,
  ct,
  auto,
  st,
  selected,
  isBusy,
  onToggle,
  onKeyDown,
  onContextMenu,
  onLogs,
  onPortMenu,
  onStop,
  onStart,
  onMore,
}: RowProps) {
  const hostPorts = c.ports.filter((p) => p.hostPort !== null);
  return (
    <tr
      tabIndex={0}
      className={selected ? "sel" : undefined}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      onDoubleClick={onLogs}
      aria-selected={selected}
    >
      <td className="ct-col-chk">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Seleccionar ${c.name}`} tabIndex={-1} />
      </td>
      <td className="ct-col-name" title={`${c.name}\n${c.id}`}>
        <span className="ct-cell-flex">
          {isBusy ? <span className="spinner ct-spinner-xs" /> : <span className={`ct-dot ct-${stateTone(c.state)}`} />}
          <span className="ct-ellipsis ct-strong">{c.name}</span>
          {c.composeProject && (
            <span className="ct-tag" title={`Proyecto Compose: ${c.composeProject}${c.composeService ? ` · servicio ${c.composeService}` : ""}`}>
              {c.composeProject}
            </span>
          )}
          {c.pod && <span className="ct-tag" title="Pod">pod {c.pod}</span>}
        </span>
      </td>
      {ct.allOwners && <td className="ct-col-owner ct-ellipsis">{ct.ownerLabel(c.owner)}</td>}
      <td className="ct-col-image ct-ellipsis mono" title={c.image}>
        {c.image}
      </td>
      <td className="ct-col-state ct-ellipsis" title={c.status}>
        {stateText(c)}
      </td>
      <td className="ct-col-ports">
        <span className="ct-ports">
          {hostPorts.slice(0, 4).map((p, i) => (
            <button key={i} className="ct-port" onClick={(e) => onPortMenu(e, p)} title="Copiar dirección o abrir túnel" tabIndex={-1}>
              {portLabel(p)}
            </button>
          ))}
          {hostPorts.length > 4 && <span className="faint">+{hostPorts.length - 4}</span>}
        </span>
      </td>
      <td className="ct-col-auto">
        <AutostartBadge info={auto.infoOf(c)} loading={auto.loading} noData={auto.noDataOf(c)} />
      </td>
      <td className="ct-col-created faint" title={c.created ? new Date(c.created * 1000).toLocaleString() : ""}>
        {ago(c.created)}
      </td>
      <td className="ct-col-num mono">{st ? percent(st.cpuPercent) : ""}</td>
      <td className="ct-col-mem mono" title={st?.memLimit ? `Límite: ${formatBytes(st.memLimit)}` : undefined}>
        {st?.memUsage !== null && st?.memUsage !== undefined ? formatBytes(st.memUsage) : ""}
      </td>
      <td className="ct-col-actions">
        <span className="ct-actions">
          {isContainerUp(c) ? (
            <button className="icon-btn" title="Parar" aria-label={`Parar ${c.name}`} onClick={onStop} disabled={isBusy} tabIndex={-1}>
              <Square size={13} />
            </button>
          ) : (
            <button
              className="icon-btn ct-go"
              title={c.state === "paused" ? "Reanudar" : "Iniciar"}
              aria-label={`Iniciar ${c.name}`}
              onClick={onStart}
              disabled={isBusy}
              tabIndex={-1}
            >
              <Play size={13} />
            </button>
          )}
          <button className="icon-btn" title="Logs" aria-label={`Logs de ${c.name}`} onClick={onLogs} tabIndex={-1}>
            <ScrollText size={13} />
          </button>
          <button
            className="icon-btn"
            title="Terminal dentro del contenedor"
            aria-label={`Terminal en ${c.name}`}
            onClick={() => ct.toTerminal(withOwner(execShellCmd(ct.engine, c.name || c.id), c.owner), true)}
            disabled={c.state !== "running"}
            tabIndex={-1}
          >
            <TerminalSquare size={13} />
          </button>
          <button className="icon-btn" title="Más acciones" aria-label={`Más acciones de ${c.name}`} onClick={onMore} tabIndex={-1}>
            <MoreHorizontal size={14} />
          </button>
        </span>
      </td>
    </tr>
  );
}
