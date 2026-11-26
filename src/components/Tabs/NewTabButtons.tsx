// Botones «+» (nueva conexión) y «Este equipo» al final de la lista de pestañas, con sus menús.
import { useCallback, useState } from "react";
import { Bot, Laptop, Plus, Server, SquareTerminal } from "lucide-react";
import { useUi } from "../../stores/ui";
import { useProfiles } from "../../stores/profiles";
import { connectToServer } from "../../features/connect";
import { LocalMenu } from "../../features/localterm/LocalMenu";
import { launchAssistant, openLocalTerminal } from "../../features/localterm/launch";
import { ASSISTANTS } from "../../features/localterm/logic";
import { PopupMenu } from "../ui/PopupMenu";

type Menu = { kind: "new" | "localMenu"; x: number; y: number };

export function NewTabButtons() {
  const profiles = useProfiles((s) => s.servers);
  const [menu, setMenu] = useState<Menu | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const toggle = (kind: Menu["kind"], el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu(menu?.kind === kind ? null : { kind, x: r.left, y: r.bottom + 4 });
  };

  return (
    <>
      <button className="icon-btn tabs-new" title="Nueva conexión" aria-label="Nueva conexión" onClick={(e) => toggle("new", e.currentTarget)}>
        <Plus size={16} />
      </button>
      <button
        className="icon-btn tabs-local-btn"
        title="Este equipo: terminal local y asistentes de IA"
        aria-label="Terminal local"
        onClick={(e) => toggle("localMenu", e.currentTarget)}
      >
        <Laptop size={15} />
      </button>

      {menu?.kind === "new" && (
        <PopupMenu x={menu.x} y={menu.y} onClose={closeMenu} minWidth={230}>
          {profiles.length > 0 && <div className="tabs-menu-label">Conectar a</div>}
          <div className="tabs-menu-scroll">
            {profiles.map((p) => (
              <button
                key={p.id}
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  void connectToServer(p, { initialPath: p.defaultPath });
                }}
              >
                <span className="tabs-menu-dot" style={p.color ? { background: p.color } : undefined} />
                <span className="tabs-menu-name">{p.name}</span>
                <span className="tabs-menu-host">
                  {p.username}@{p.host}
                </span>
              </button>
            ))}
          </div>
          {profiles.length > 0 && <hr />}
          <button
            role="menuitem"
            onClick={() => {
              closeMenu();
              useUi.getState().openServerEditor();
            }}
          >
            <Server size={14} /> Nuevo servidor…
          </button>
          <hr />
          <div className="tabs-menu-label">Este equipo</div>
          <button
            role="menuitem"
            onClick={() => {
              closeMenu();
              openLocalTerminal();
            }}
          >
            <SquareTerminal size={14} /> Terminal local
          </button>
          {ASSISTANTS.map((a) => (
            <button
              key={a.tool}
              role="menuitem"
              onClick={() => {
                closeMenu();
                void launchAssistant(a.tool);
              }}
            >
              <Bot size={14} /> {a.label}
            </button>
          ))}
        </PopupMenu>
      )}

      {menu?.kind === "localMenu" && <LocalMenu x={menu.x} y={menu.y} onClose={closeMenu} />}
    </>
  );
}
