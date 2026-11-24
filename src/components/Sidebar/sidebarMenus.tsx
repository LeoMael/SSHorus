// Menús de la barra lateral: servidor, proyecto, marcador, «añadir al proyecto» y botón «Nuevo».
import {
  Bookmark as BookmarkIcon,
  Bot,
  Copy,
  CopyPlus,
  Download,
  Folder,
  FolderPlus,
  Laptop,
  LayoutDashboard,
  Layers,
  MinusCircle,
  Pencil,
  Plug,
  Plus,
  Server,
  SquareTerminal,
  Trash2,
  Upload,
  Waypoints,
} from "lucide-react";
import type { Bookmark, Project, ServerProfile } from "../../api/types";
import { connectToMany } from "../../features/connect/connect";
import { openFleet } from "../../features/fleet/tabs";
import { openProjectMap } from "../../features/infra/store";
import { launchAssistant, openLocalTerminal } from "../../features/localterm/launch";
import { ASSISTANTS } from "../../features/localterm/logic";
import { openMultiRun } from "../../features/multirun/store";
import { serversNotInProject } from "../../features/profiles/projectServers";
import { SSH_CONFIG_LABEL } from "../../lib/platform";
import { useProfiles } from "../../stores/profiles";
import { useUi } from "../../stores/ui";
import type { MenuItem } from "./SbContextMenu";
import { addBookmarkFor, connectNew, deleteProject, deleteServer, exportSshConfig, openOrFocus } from "./sidebarActions";
import { projectServers, type TabState } from "./sidebarLogic";

export interface MenuDeps {
  serverById: ReadonlyMap<string, ServerProfile>;
  tabStates: ReadonlyMap<string, TabState>;
  connecting: Record<string, true>;
  /** Selecciona y muestra un servidor (dentro de su proyecto, o en «Servidores» con ""). */
  revealServer: (s: ServerProfile, projectId: string) => void;
  openImport: () => void;
}

export function sidebarMenus({ serverById, tabStates, connecting, revealServer, openImport }: MenuDeps) {
  const { openServerEditor, openProjectEditor } = useUi.getState();

  /** Submenú con los servidores guardados que aún no están en el proyecto. */
  const existingServerItems = (p: Project): MenuItem[] => {
    const all = useProfiles.getState().servers;
    const candidates = serversNotInProject(all, p);
    if (candidates.length === 0) {
      return [{ label: all.length === 0 ? "No hay servidores guardados" : "Ya están todos en el proyecto", disabled: true }];
    }
    return candidates.map((s) => ({
      label: s.name,
      icon: <Server size={14} />,
      onClick: () =>
        void useProfiles
          .getState()
          .addServerToProject(p.id, s.id)
          .then((ok) => ok && revealServer(s, p.id)),
    }));
  };

  /** Lo que se puede añadir a un proyecto (menú del botón + y parte del menú contextual). */
  const addToProject = (p: Project): MenuItem[] => [
    {
      label: "Añadir servidor nuevo…",
      icon: <Plus size={14} />,
      // Editor de servidor nuevo que lo guarda ya dentro del proyecto (se puede cambiar en el selector).
      onClick: () => openServerEditor(null, { projectId: p.id, onSaved: revealServer }),
    },
    { label: "Añadir servidor existente", icon: <Server size={14} />, submenu: existingServerItems(p) },
  ];

  const server = (s: ServerProfile, projectId?: string): MenuItem[] => {
    const st = useProfiles.getState();
    const projectItems: MenuItem[] =
      st.projects.length === 0
        ? [{ label: "No hay proyectos", disabled: true }]
        : st.projects.map((p) => ({
            label: p.name,
            icon: <span className="sb-chip" style={{ background: p.color ?? undefined }} />,
            disabled: p.serverIds.includes(s.id),
            onClick: () => void st.addServerToProject(p.id, s.id),
          }));
    projectItems.push("separator", {
      label: "Nuevo proyecto…",
      icon: <FolderPlus size={14} />,
      onClick: () => openProjectEditor({ id: "", name: "", serverIds: [s.id], bookmarks: [], color: null }),
    });

    const tabState = tabStates.get(s.id);
    const busy = !!connecting[s.id];
    const items: MenuItem[] = [
      {
        label: !tabState ? "Conectar" : tabState === "closed" ? "Ir a su pestaña y reconectar" : "Ir a su pestaña",
        icon: <Plug size={14} />,
        onClick: () => openOrFocus(s),
        disabled: busy,
      },
    ];
    if (tabState) {
      items.push({ label: "Abrir otra conexión", icon: <CopyPlus size={14} />, onClick: () => connectNew(s), disabled: busy });
    }
    items.push(
      {
        label: "Ejecutar en varios servidores…",
        icon: <SquareTerminal size={14} />,
        onClick: () => openMultiRun({ profileIds: [s.id] }),
      },
      "separator",
      { label: "Editar…", icon: <Pencil size={14} />, onClick: () => openServerEditor(s) },
      { label: "Duplicar", icon: <Copy size={14} />, onClick: () => void st.duplicateServer(s.id) },
      { label: "Añadir a proyecto", icon: <Layers size={14} />, submenu: projectItems },
    );
    if (projectId) {
      const p = st.projects.find((x) => x.id === projectId);
      items.push(
        { label: "Añadir marcador…", icon: <BookmarkIcon size={14} />, onClick: () => void addBookmarkFor(projectId, s) },
        {
          label: "Quitar del proyecto",
          icon: <MinusCircle size={14} />,
          onClick: () =>
            p &&
            void st.saveProject({
              ...p,
              serverIds: p.serverIds.filter((x) => x !== s.id),
              bookmarks: p.bookmarks.filter((b) => b.serverId !== s.id),
            }),
        },
      );
    }
    items.push("separator", {
      label: "Eliminar",
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => void deleteServer(s),
    });
    return items;
  };

  const project = (p: Project): MenuItem[] => {
    const projServers = projectServers(p, serverById);
    const none = projServers.length === 0;
    return [
      { label: "Editar…", icon: <Pencil size={14} />, onClick: () => openProjectEditor(p) },
      ...addToProject(p),
      "separator",
      { label: "Conectar a todos", icon: <Plug size={14} />, disabled: none, onClick: () => void connectToMany(projServers) },
      {
        label: "Ejecutar comando en el proyecto…",
        icon: <SquareTerminal size={14} />,
        disabled: none,
        onClick: () => openMultiRun({ projectId: p.id }),
      },
      { label: "Mapa", icon: <Waypoints size={14} />, disabled: none, onClick: () => openProjectMap(p.id) },
      { label: "Panel del proyecto", icon: <LayoutDashboard size={14} />, disabled: none, onClick: () => openFleet(p.id) },
      "separator",
      { label: "Eliminar", icon: <Trash2 size={14} />, danger: true, onClick: () => void deleteProject(p) },
    ];
  };

  const bookmark = (p: Project, b: Bookmark, s: ServerProfile | undefined): MenuItem[] => [
    { label: "Abrir", icon: <Folder size={14} />, disabled: !s, onClick: () => s && connectNew(s, b.path) },
    { label: "Editar proyecto…", icon: <Pencil size={14} />, onClick: () => openProjectEditor(p) },
    "separator",
    {
      label: "Quitar marcador",
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => void useProfiles.getState().removeBookmark(p.id, b.serverId, b.path),
    },
  ];

  const newItems = (): MenuItem[] => [
    { label: "Servidor", icon: <Server size={14} />, onClick: () => openServerEditor(null) },
    { label: "Proyecto", icon: <Layers size={14} />, onClick: () => openProjectEditor(null) },
    "separator",
    { label: `Importar de ${SSH_CONFIG_LABEL}…`, icon: <Download size={14} />, onClick: openImport },
    { label: `Exportar a ${SSH_CONFIG_LABEL}`, icon: <Upload size={14} />, onClick: () => void exportSshConfig() },
    "separator",
    { label: "Terminal local (este equipo)", icon: <Laptop size={14} />, onClick: () => openLocalTerminal() },
    ...ASSISTANTS.map((a) => ({ label: a.label, icon: <Bot size={14} />, onClick: () => void launchAssistant(a.tool) })),
  ];

  return { server, project, bookmark, addToProject, newItems };
}

export type SidebarMenus = ReturnType<typeof sidebarMenus>;
