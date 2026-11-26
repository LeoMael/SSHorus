// Lista de contenedores: filtros, búsqueda, acciones por fila y en lote, CPU/memoria en vivo.
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Copy, Play } from "lucide-react";
import { statsFor, toggleKey, type Container, type PortMapping } from "../../features/containers";
import { ContextMenu, type MenuItem } from "../ui/ContextMenu";
import { useCt } from "./context";
import { openPortTunnel } from "./tunnel";
import {
  ContainerRow,
  ContainersBatchBar,
  containerRowKey,
  filterAndSortContainers,
  isContainerUp,
  type ContainerFilter,
  type ContainerSortKey,
} from "./ContainersTable";
import { ContainersToolbar, NewContainerButton } from "./ContainersToolbar";
import { copy, useContainerActions } from "./useContainerActions";

export function ContainersTab() {
  const ct = useCt();
  const { res, stats, autostart: auto } = ct;
  const list = useMemo(() => res.containers.data ?? [], [res.containers.data]);
  const [filter, setFilter] = useState<ContainerFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: ContainerSortKey; dir: 1 | -1 }>({ key: "state", dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const { busy, direct, confirmAction, confirmRemove, openLogs, rowMenu } = useContainerActions(ct, () => setSelected(new Set()));

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
        { label: `Copiar ${host}:${port}`, icon: <Copy size={13} />, onSelect: () => copy(`${host}:${port}`, "Dirección copiada") },
        {
          label: "Abrir túnel a mi PC…",
          icon: <Play size={13} />,
          title: "Crea un túnel SSH para usar este puerto desde tu PC",
          onSelect: () => void openPortTunnel(ct.sessionId, ct.profileId, p),
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

  const toggle = (id: string) => setSelected((s) => toggleKey(s, id));

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
      <ContainersToolbar ct={ct} filter={filter} onFilter={setFilter} counts={counts} search={search} onSearch={setSearch} />

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
            <NewContainerButton ct={ct} label="Crear el primero" />
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
      {menu && <ContextMenu look="plain" x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
