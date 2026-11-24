// Lista de contenedores: filtros, búsqueda, acciones por fila y en lote, CPU/memoria en vivo.
import { useCallback, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  Copy,
  FileSearch,
  Pause,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  ScrollText,
  Search,
  Square,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import {
  containerAction,
  execShellCmd,
  logsCmd,
  removeContainers,
  renameContainer,
  stateTone,
  statsFor,
  validateObjName,
  withOwner,
  type Container,
  type ContainerAction,
  type PortMapping,
} from "../../features/containers";
import { clipboard } from "../../lib/clipboard";
import { toast } from "../../stores/toasts";
import { promptDialog } from "../ui/dialogs";
import { ContextMenu, type MenuItem } from "../Admin/ContextMenu";
import { PICK_OWNER_HINT, useCt } from "./context";
import { openPortTunnel } from "./tunnel";
import { askAutostart, autostartMenuLabel } from "./Autostart";
import {
  ContainerRow,
  ContainersBatchBar,
  containerRowKey,
  filterAndSortContainers,
  isContainerUp,
  type ContainerFilter,
  type ContainerSortKey,
} from "./ContainersTable";

const ACTION_TEXT: Record<ContainerAction, { done: string; verb: string }> = {
  start: { done: "Contenedor iniciado", verb: "Iniciar" },
  stop: { done: "Contenedor parado", verb: "Parar" },
  restart: { done: "Contenedor reiniciado", verb: "Reiniciar" },
  pause: { done: "Contenedor en pausa", verb: "Pausar" },
  unpause: { done: "Contenedor reanudado", verb: "Reanudar" },
};

function copy(text: string, what = "Copiado") {
  clipboard.write(text).then(
    () => toast.success(what, text),
    (e) => toast.error("No se pudo copiar", e),
  );
}

export function ContainersTab() {
  const ct = useCt();
  const { engine, res, stats, autostart: auto } = ct;
  const list = useMemo(() => res.containers.data ?? [], [res.containers.data]);
  const [filter, setFilter] = useState<ContainerFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: ContainerSortKey; dir: 1 | -1 }>({ key: "state", dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuItem | "sep")[] } | null>(null);

  const counts = useMemo(
    () => ({
      all: list.length,
      running: list.filter(isContainerUp).length,
      stopped: list.filter((c) => !isContainerUp(c)).length,
    }),
    [list],
  );

  const rows = useMemo(
    () =>
      filterAndSortContainers(list, {
        filter,
        search,
        sort,
        stats,
        allOwners: ct.allOwners,
        ownerLabel: ct.ownerLabel,
        autostartVerdict: (c) => auto.infoOf(c)?.verdict,
      }),
    [list, filter, search, sort, stats, ct.allOwners, ct.ownerLabel, auto],
  );

  const visibleIds = new Set(rows.map(containerRowKey));
  const sel = list.filter((c) => selected.has(containerRowKey(c)) && visibleIds.has(containerRowKey(c)));

  const setBusyIds = (ids: string[], on: boolean) =>
    setBusy((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });

  const { run, reload, perOwner } = ct;
  const direct = useCallback(
    async (action: ContainerAction, cs: Container[]) => {
      const ids = cs.map(containerRowKey);
      setBusyIds(ids, true);
      const r = await run(perOwner(cs, (g) => containerAction(engine, action, g.map((c) => c.name || c.id))), 120);
      setBusyIds(ids, false);
      if (r.ok)
        toast.success(
          cs.length > 1 ? `${ACTION_TEXT[action].verb}: ${cs.length} contenedores` : ACTION_TEXT[action].done,
          cs.length === 1 ? cs[0].name : undefined,
        );
      else toast.error(`No se pudo ${ACTION_TEXT[action].verb.toLowerCase()}`, r.error ?? undefined);
      await reload("containers");
    },
    [run, reload, perOwner, engine],
  );

  const names = (cs: Container[]) => (
    <ul className="ct-list">
      {cs.slice(0, 12).map((c) => (
        <li key={containerRowKey(c)}>
          <span className={`ct-dot ct-${stateTone(c.state)}`} /> <strong>{c.name}</strong> <span className="faint">{c.image}</span>
          {ct.allOwners && <span className="ct-tag">{ct.ownerLabel(c.owner)}</span>}
        </li>
      ))}
      {cs.length > 12 && <li className="faint">… y {cs.length - 12} más</li>}
    </ul>
  );

  const confirmAction = (action: "stop" | "restart", cs: Container[]) => {
    ct.review({
      title: `${ACTION_TEXT[action].verb} ${cs.length > 1 ? `${cs.length} contenedores` : `«${cs[0].name}»`}`,
      message:
        action === "stop"
          ? "Se enviará la señal de parada; si no termina en 10 segundos se fuerza."
          : "Se parará y se volverá a arrancar. Los servicios dejarán de responder unos segundos.",
      details: () => names(cs),
      build: () => ct.perOwner(cs, (g) => containerAction(engine, action, g.map((c) => c.name || c.id))),
      runLabel: ACTION_TEXT[action].verb,
      success: cs.length > 1 ? `${ACTION_TEXT[action].verb}: ${cs.length} contenedores` : ACTION_TEXT[action].done,
      reload: ["containers"],
      onDone: () => setSelected(new Set()),
    });
  };

  const confirmRemove = (cs: Container[]) => {
    const anyRunning = cs.some((c) => isContainerUp(c) || c.state === "paused");
    ct.review({
      title: cs.length > 1 ? `Eliminar ${cs.length} contenedores` : `Eliminar «${cs[0].name}»`,
      message: "Se borra el contenedor y todo lo que tenga dentro que no esté en un volumen o carpeta montada. No se puede deshacer.",
      details: () => names(cs),
      options: [
        { key: "force", label: "Forzar (parar si está en marcha)", hint: anyRunning ? "Hay contenedores en marcha" : undefined, initial: anyRunning },
        { key: "volumes", label: "Borrar también sus volúmenes anónimos (-v)" },
      ],
      build: (o) => ct.perOwner(cs, (g) => removeContainers(engine, g.map((c) => c.name || c.id), { force: !!o.force, volumes: !!o.volumes })),
      danger: true,
      runLabel: "Eliminar",
      success: cs.length > 1 ? `${cs.length} contenedores eliminados` : `Contenedor «${cs[0].name}» eliminado`,
      reload: ["containers"],
      onDone: () => setSelected(new Set()),
    });
  };

  const rename = async (c: Container) => {
    const name = await promptDialog({
      title: `Renombrar «${c.name}»`,
      label: "Nuevo nombre",
      initial: c.name,
      confirmText: "Renombrar",
      validate: (v) => validateObjName(v.trim()) ?? (v.trim() === c.name ? "Es el mismo nombre" : null),
    });
    if (!name) return;
    setBusyIds([containerRowKey(c)], true);
    const r = await ct.run([withOwner(renameContainer(engine, c.id, name.trim()), c.owner)], 30);
    setBusyIds([containerRowKey(c)], false);
    if (r.ok) toast.success("Contenedor renombrado", `${c.name} → ${name.trim()}`);
    else toast.error("No se pudo renombrar", r.error ?? undefined);
    await ct.reload("containers");
  };

  const openLogs = (c: Container) =>
    ct.openLogs({
      title: ct.allOwners ? `Logs de «${c.name}» (${ct.ownerLabel(c.owner)})` : `Logs de «${c.name}»`,
      build: (tail, ts) => withOwner(logsCmd(engine, c.name || c.id, tail, { timestamps: ts }), c.owner),
      follow: (tail) => withOwner(logsCmd(engine, c.name || c.id, tail, { follow: true }), c.owner),
    });

  const autostartItem = (c: Container): MenuItem => {
    const info = auto.infoOf(c);
    const { on, label } = autostartMenuLabel(info);
    return {
      label,
      icon: <Power size={13} />,
      onClick: () => askAutostart(ct, auto, on, [c]),
      disabled: !info,
      title: info ? info.why.join("\n") : auto.loading ? "Leyendo si arranca solo…" : "No se pudo saber si arranca solo",
    };
  };

  const rowMenu = (c: Container): (MenuItem | "sep")[] => [
    isContainerUp(c)
      ? { label: "Parar", icon: <Square size={13} />, onClick: () => confirmAction("stop", [c]) }
      : { label: "Iniciar", icon: <Play size={13} />, onClick: () => void direct(c.state === "paused" ? "unpause" : "start", [c]) },
    { label: "Reiniciar", icon: <RotateCw size={13} />, onClick: () => confirmAction("restart", [c]), disabled: !isContainerUp(c) && c.state !== "paused" },
    c.state === "paused"
      ? { label: "Reanudar", icon: <Play size={13} />, onClick: () => void direct("unpause", [c]) }
      : { label: "Pausar", icon: <Pause size={13} />, onClick: () => void direct("pause", [c]), disabled: c.state !== "running" },
    "sep",
    { label: "Ver logs", icon: <ScrollText size={13} />, onClick: () => openLogs(c) },
    {
      label: "Terminal dentro",
      icon: <TerminalSquare size={13} />,
      onClick: () => ct.toTerminal(withOwner(execShellCmd(engine, c.name || c.id), c.owner), true),
      disabled: c.state !== "running",
    },
    { label: "Inspeccionar", icon: <FileSearch size={13} />, onClick: () => ct.openInspect(c) },
    { label: "Renombrar…", icon: <Pencil size={13} />, onClick: () => void rename(c) },
    autostartItem(c),
    "sep",
    { label: "Copiar nombre", icon: <Copy size={13} />, onClick: () => copy(c.name, "Nombre copiado") },
    { label: "Copiar ID", icon: <Copy size={13} />, onClick: () => copy(c.id, "ID copiado") },
    "sep",
    { label: "Eliminar…", icon: <Trash2 size={13} />, onClick: () => confirmRemove([c]), danger: true },
  ];

  const portMenu = (e: MouseEvent, p: PortMapping) => {
    e.stopPropagation();
    const port = p.hostPort;
    if (port === null) return;
    const host = p.hostIp && p.hostIp !== "127.0.0.1" && p.hostIp !== "::1" ? p.hostIp : "localhost";
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: r.left,
      y: r.bottom + 2,
      items: [
        { label: `Copiar ${host}:${port}`, icon: <Copy size={13} />, onClick: () => copy(`${host}:${port}`, "Dirección copiada") },
        {
          label: "Abrir túnel a mi PC…",
          icon: <Play size={13} />,
          title: "Crea un túnel SSH para usar este puerto desde tu PC",
          onClick: () => void openPortTunnel(ct.sessionId, ct.profileId, p),
          disabled: p.protocol !== "tcp",
        },
      ],
    });
  };

  const openRowMenu = (e: MouseEvent | KeyboardEvent, c: Container) => {
    e.preventDefault();
    const pos = "clientX" in e && e.clientX
      ? { x: e.clientX, y: e.clientY }
      : (() => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          return { x: r.right - 200, y: r.bottom };
        })();
    setMenu({ ...pos, items: rowMenu(c) });
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, c: Container) => {
    if (e.target !== e.currentTarget) return;
    const tr = e.currentTarget;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      (tr.nextElementSibling as HTMLElement | null)?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      (tr.previousElementSibling as HTMLElement | null)?.focus();
    } else if (e.key === " ") {
      e.preventDefault();
      toggle(containerRowKey(c));
    } else if (e.key === "Enter") {
      e.preventDefault();
      openLogs(c);
    } else if (e.key === "Delete") {
      e.preventDefault();
      confirmRemove([c]);
    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      openRowMenu(e, c);
    }
  };

  const sortBy = (key: ContainerSortKey) =>
    setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === "created" || key === "cpu" || key === "mem" ? -1 : 1 }));
  const th = (key: ContainerSortKey, label: string, cls?: string, title?: string) => (
    <th className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} title={title}>
      <button className="ct-th" onClick={() => sortBy(key)}>
        {label}
        {sort.key === key && <span className="ct-sort">{sort.dir === 1 ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(containerRowKey(r)));
  const loading = res.containers.loading;

  return (
    <div className="ct-tab-body">
      <div className="ct-toolbar">
        <div className="ct-seg ct-seg-sm" role="radiogroup" aria-label="Filtro">
          {(
            [
              ["all", "Todos"],
              ["running", "En marcha"],
              ["stopped", "Parados"],
            ] as [ContainerFilter, string][]
          ).map(([f, label]) => (
            <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {label} <span className="ct-count">{counts[f]}</span>
            </button>
          ))}
        </div>
        <div className="ct-search">
          <Search size={13} />
          <input
            className="input"
            placeholder="Buscar nombre, imagen, puerto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar contenedores"
          />
          {search && (
            <button className="icon-btn" onClick={() => setSearch("")} aria-label="Limpiar búsqueda">
              <X size={12} />
            </button>
          )}
        </div>
        <span className="ct-grow" />
        <button
          className="icon-btn"
          onClick={() => {
            void ct.reload("containers");
            void auto.reload();
          }}
          title="Actualizar"
          aria-label="Actualizar"
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "ct-spin" : undefined} />
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => ct.openRunForm()}
          disabled={!ct.newOwner}
          title={ct.newOwner ? undefined : PICK_OWNER_HINT}
        >
          <Plus size={13} /> Nuevo contenedor
        </button>
      </div>

      {sel.length > 0 && (
        <ContainersBatchBar
          sel={sel}
          ct={ct}
          auto={auto}
          onDirect={(a, cs) => void direct(a, cs)}
          onConfirm={confirmAction}
          onRemove={confirmRemove}
          onClear={() => setSelected(new Set())}
        />
      )}

      {res.containers.error && (
        <div className="ct-error ct-error-inline" role="alert">
          <pre>{res.containers.error}</pre>
          <button className="btn btn-sm" onClick={() => void ct.reload("containers")}>
            Reintentar
          </button>
        </div>
      )}

      <div className="ct-table-wrap" tabIndex={0} role="region" aria-label="Lista de contenedores">
        {res.containers.data === null && loading ? (
          <div className="empty-state">
            <span className="spinner" />
            <div>Leyendo contenedores…</div>
          </div>
        ) : list.length === 0 && res.containers.data !== null ? (
          <div className="empty-state">
            <div>No hay contenedores todavía</div>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => ct.openRunForm()}
              disabled={!ct.newOwner}
              title={ct.newOwner ? undefined : PICK_OWNER_HINT}
            >
              <Plus size={13} /> Crear el primero
            </button>
          </div>
        ) : (
          <table className="ct-table ct-table-containers">
            <thead>
              <tr>
                <th className="ct-col-chk">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todos"
                    checked={allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map(containerRowKey)))}
                  />
                </th>
                {th("name", "Nombre", "ct-col-name")}
                {ct.allOwners && th("owner", "Usuario", "ct-col-owner")}
                {th("image", "Imagen", "ct-col-image")}
                {th("state", "Estado", "ct-col-state")}
                <th className="ct-col-ports">Puertos</th>
                {th("autostart", "Al reiniciar", "ct-col-auto", "Si el contenedor está activado para levantarse solo tras reiniciar el servidor")}
                {th("created", "Creado", "ct-col-created")}
                {th("cpu", "CPU", "ct-col-num")}
                {th("mem", "Memoria", "ct-col-mem")}
                <th className="ct-col-actions">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const k = containerRowKey(c);
                return (
                  <ContainerRow
                    key={k}
                    c={c}
                    ct={ct}
                    auto={auto}
                    st={c.state === "running" ? statsFor(stats, c) : undefined}
                    selected={selected.has(k)}
                    isBusy={busy.has(k)}
                    onToggle={() => toggle(k)}
                    onKeyDown={(e) => onRowKey(e, c)}
                    onContextMenu={(e) => openRowMenu(e, c)}
                    onLogs={() => openLogs(c)}
                    onPortMenu={portMenu}
                    onStop={() => confirmAction("stop", [c])}
                    onStart={() => void direct(c.state === "paused" ? "unpause" : "start", [c])}
                    onMore={(e) => openRowMenu(e, c)}
                  />
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={ct.allOwners ? 11 : 10} className="ct-norows">
                    Ningún contenedor coincide con el filtro
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <div className="ct-foot faint">
        Enter: logs · Espacio: seleccionar · Supr: eliminar · Menú o Mayús+F10: más acciones
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
