// Barra lateral: conexión rápida, proyectos (con marcadores) y servidores guardados.
// DUEÑO: agente Almacenamiento/Sidebar. El ancho lo controla el padre.
import { Suspense, useEffect, useMemo, useState } from "react";
import { Download, Plus, Server } from "lucide-react";
import type { ServerProfile } from "../../api/types";
import { useProfiles } from "../../stores/profiles";
import { useTabs } from "../../stores/tabs";
import { useUi } from "../../stores/ui";
import { SbContextMenu } from "./SbContextMenu";
import { FleetButton } from "../Fleet/FleetButton";
import { preloadable } from "../../lib/lazy";
import "./Sidebar.css";
import { SSH_CONFIG_LABEL } from "../../lib/platform";
import { filterProjects, matchesServer, parseTabStates, serverRowKey, tabStatesKey } from "./sidebarLogic";
import { sidebarMenus } from "./sidebarMenus";
import { machineKey, machineRowKey } from "../../features/sidebar/machineGroups";
import { useAccountSudo } from "./useAccountSudo";
import { useCollapsedMachines, useCollapsedProjects } from "./useCollapsedProjects";
import { useSidebarTree } from "./useSidebarTree";
import { ServerItems } from "./MachineGroup";
import type { RowApi } from "./SidebarRows";
import { ProjectGroup } from "./ProjectGroup";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarInputs } from "./SidebarInputs";

const ImportSshConfigDialog = preloadable(() => import("./ImportSshConfigDialog").then((m) => m.ImportSshConfigDialog));

export function Sidebar() {
  const servers = useProfiles((s) => s.servers);
  const projects = useProfiles((s) => s.projects);
  const loaded = useProfiles((s) => s.loaded);
  const load = useProfiles((s) => s.load);
  const connecting = useProfiles((s) => s.connecting);
  // Estado de las pestañas por servidor (texto): cambiar de pestaña no redibuja la barra.
  const tabStatesKeyValue = useTabs((s) => tabStatesKey(s.tabs));
  const openServerEditor = useUi((s) => s.openServerEditor);
  const openProjectEditor = useUi((s) => s.openProjectEditor);

  const [query, setQuery] = useState("");
  const { collapsed, toggleProject } = useCollapsedProjects();
  const machines = useCollapsedMachines();
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const tabStates = useMemo(() => parseTabStates(tabStatesKeyValue), [tabStatesKeyValue]);
  const serverById = useMemo(() => new Map(servers.map((s) => [s.id, s])), [servers]);

  const q = query.trim().toLowerCase();
  const visibleProjects = useMemo(() => filterProjects(projects, serverById, q), [projects, serverById, q]);
  const visibleServers = useMemo(() => (q ? servers.filter((s) => matchesServer(s, q)) : servers), [servers, q]);
  const tree = useSidebarTree();
  const sudoOf = useAccountSudo(servers);

  /** Selecciona y muestra un servidor: dentro de su proyecto (que se despliega) o en «Servidores»; si
   *  está dentro del nodo de su máquina, también lo despliega. */
  const revealServer = (s: ServerProfile, projectId: string) => {
    const key = serverRowKey(s.id, projectId);
    if (projectId) toggleProject(projectId, true);
    machines.toggle(machineRowKey(machineKey(s), projectId), true);
    if (q && !matchesServer(s, q)) setQuery("");
    tree.setSelected(key);
    tree.setReveal(key);
  };

  const menus = sidebarMenus({ serverById, tabStates, connecting, revealServer, openImport: () => setImportOpen(true) });
  const api: RowApi = { tree, menus, connecting, tabStates, serverById, sudoOf, machines };

  const isEmpty = loaded && servers.length === 0 && projects.length === 0;

  return (
    <aside className="sb" aria-label="Servidores">
      <SidebarHeader
        onNewMenu={(el) => tree.openMenuBelow(el, menus.newItems())}
        noServers={loaded && servers.length === 0}
      />
      <SidebarInputs query={query} setQuery={setQuery} onQuickConnected={(id) => tree.setSelected(serverRowKey(id))} />

      {isEmpty ? (
        <div className="empty-state sb-empty">
          <Server size={28} strokeWidth={1.5} />
          <div>Aún no tienes servidores guardados.</div>
          <button className="btn btn-primary btn-sm" onClick={() => openServerEditor(null)}>
            <Plus size={14} /> Añadir servidor
          </button>
          <button className="btn btn-sm" onClick={() => setImportOpen(true)}>
            <Download size={14} /> Importar de {SSH_CONFIG_LABEL}
          </button>
        </div>
      ) : (
        <div className="sb-list" ref={tree.listRef} role="tree" onKeyDown={tree.onListKeyDown}>
          {!loaded && (
            <div className="sb-loading">
              <span className="spinner sb-spinner" /> Cargando…
            </div>
          )}

          {projects.length > 0 && (!q || visibleProjects.length > 0) && (
            <section className="sb-section">
              <div className="sb-section-head">
                <span className="section-label">Proyectos</span>
                <button
                  className="icon-btn sb-section-btn"
                  title="Nuevo proyecto"
                  aria-label="Nuevo proyecto"
                  onClick={() => openProjectEditor(null)}
                >
                  <Plus size={13} />
                </button>
              </div>
              {visibleProjects.map((entry) => (
                <ProjectGroup
                  key={`p:${entry.project.id}`}
                  api={api}
                  entry={entry}
                  q={q}
                  collapsed={!!collapsed[entry.project.id]}
                  toggleProject={toggleProject}
                />
              ))}
            </section>
          )}

          {loaded && (!q || visibleServers.length > 0) && (
            <section className="sb-section">
              <div className="sb-section-head">
                <span className="section-label">Servidores</span>
                <FleetButton disabled={servers.length === 0} />
                <button
                  className="icon-btn sb-section-btn"
                  title="Nuevo servidor"
                  aria-label="Nuevo servidor"
                  onClick={() => openServerEditor(null)}
                >
                  <Plus size={13} />
                </button>
              </div>
              <ServerItems api={api} servers={visibleServers} q={q} />
              {servers.length === 0 && <div className="sb-row sb-placeholder">Sin servidores</div>}
            </section>
          )}

          {q && visibleProjects.length === 0 && visibleServers.length === 0 && (
            <div className="sb-no-results">Sin resultados para «{query.trim()}»</div>
          )}
        </div>
      )}

      {importOpen && (
        <Suspense fallback={null}>
          <ImportSshConfigDialog onClose={() => setImportOpen(false)} />
        </Suspense>
      )}
      {tree.menu && <SbContextMenu x={tree.menu.x} y={tree.menu.y} items={tree.menu.items} onClose={tree.closeMenu} />}
    </aside>
  );
}
