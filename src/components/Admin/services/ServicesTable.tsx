// Tabla de «Servicios»: nombre, estado, si arranca al encender, descripción y botones; clic derecho para
// todas las acciones y doble clic (o Intro) para ver su registro.
import { useState, type MouseEvent } from "react";
import { ScrollText } from "lucide-react";
import { actionsFor, isSshService, SERVICE_ACTIONS, type BootState, type HumanUser, type InitSystem, type RunState, type Service, type ServiceAction } from "../../../features/services";
import { ContextMenu, type MenuItem } from "../../ui/ContextMenu";
import { VirtualTable, type Column } from "../VirtualTable";

const STATE: Record<RunState, { text: string; cls: string }> = {
  running: { text: "Activo", cls: "adm-tag-green" },
  failed: { text: "Caído", cls: "adm-tag-red" },
  stopped: { text: "Parado", cls: "svc-tag-off" },
  starting: { text: "Arrancando", cls: "adm-tag-yellow" },
  other: { text: "—", cls: "svc-tag-off" },
};

const BOOT: Record<BootState, { text: string; title: string }> = {
  enabled: { text: "Sí", title: "Arranca solo al encender el servidor" },
  disabled: { text: "No", title: "No arranca solo: hay que arrancarlo a mano" },
  static: { text: "Lo arranca otro", title: "No se activa por sí mismo: lo arranca otro servicio, un timer o un socket" },
  masked: { text: "Bloqueado", title: "Está bloqueado (masked): no se puede arrancar ni a mano" },
  other: { text: "—", title: "" },
};

/** Las dos primeras acciones van como botón; el resto, en el menú. */
const INLINE = 2;

export function ServicesTable({
  rows,
  init,
  user,
  onAction,
  onLogs,
}: {
  rows: Service[];
  init: InitSystem;
  user: HumanUser | null;
  onAction: (s: Service, a: ServiceAction) => void;
  onLogs: (s: Service) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; s: Service } | null>(null);
  const hasLogs = init === "systemd";

  const menuItems = (s: Service): MenuItem[] => [
    ...actionsFor(s, init, user).map((a) => ({ label: `${SERVICE_ACTIONS[a].label}…`, onSelect: () => onAction(s, a) })),
    ...(hasLogs ? [{ label: "Ver su registro", icon: <ScrollText size={13} />, onSelect: () => onLogs(s) }] : []),
  ];

  const columns: Column<Service>[] = [
    {
      key: "name",
      label: "Servicio",
      width: "minmax(160px, 1.1fr)",
      render: (s) => (
        <span className="adm-name">
          {s.name}
          {!user && isSshService(s.unit) && <span className="adm-tag adm-tag-accent" title="Es el servicio por el que entras al servidor">SSH</span>}
        </span>
      ),
      title: (s) => s.unit,
    },
    {
      key: "state",
      label: "Estado",
      width: "100px",
      render: (s) => <span className={`adm-tag ${STATE[s.state].cls}`}>{STATE[s.state].text}</span>,
      title: (s) => s.raw,
    },
    {
      key: "boot",
      label: "Al encender",
      width: "120px",
      render: (s) => (s.boot ? <span title={BOOT[s.boot].title}>{BOOT[s.boot].text}</span> : <span className="faint">—</span>),
      title: (s) => s.bootRaw ?? "",
    },
    { key: "desc", label: "Descripción", width: "minmax(160px, 2fr)", render: (s) => <span className="faint">{s.description}</span>, title: (s) => s.description },
    {
      key: "act",
      label: "",
      width: "220px",
      render: (s) => (
        <span className="adm-cell-flex">
          {actionsFor(s, init, user)
            .slice(0, INLINE)
            .map((a) => (
              <button
                key={a}
                className="btn btn-sm adm-row-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(s, a);
                }}
              >
                {SERVICE_ACTIONS[a].label}
              </button>
            ))}
          {hasLogs && (
            <button
              className="icon-btn adm-row-btn"
              title="Ver su registro"
              aria-label={`Ver el registro de ${s.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onLogs(s);
              }}
            >
              <ScrollText size={12} />
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <VirtualTable
        label="Servicios"
        columns={columns}
        rows={rows}
        rowKey={(s) => s.unit}
        selected={selected}
        onSelect={setSelected}
        onActivate={(s) => hasLogs && onLogs(s)}
        onContextMenu={(e: MouseEvent, s) => setMenu({ x: e.clientX, y: e.clientY, s })}
        rowClass={(s) => (s.state === "failed" ? "svc-row-failed" : "")}
        placeholder={<div className="adm-empty-text">Ningún servicio con ese filtro.</div>}
      />
      {menu && <ContextMenu look="plain" x={menu.x} y={menu.y} items={menuItems(menu.s)} onClose={() => setMenu(null)} />}
    </>
  );
}
