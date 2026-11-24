// «Añadir a proyecto» del menú contextual del explorador: guarda una carpeta remota como
// marcador de un proyecto (y añade el servidor al proyecto si aún no está).
import { FolderKanban, FolderPlus } from "lucide-react";
import type { Bookmark, Project } from "../../api/types";
import { basename } from "../../lib/paths";
import { useProfiles } from "../../stores/profiles";
import { toast } from "../../stores/toasts";
import { useUi } from "../../stores/ui";
import type { MenuItem } from "../ui/ContextMenu";

function hasBookmark(p: Project, b: Bookmark): boolean {
  return p.bookmarks.some((x) => x.serverId === b.serverId && x.path === b.path);
}

/** Guarda el marcador y, si hace falta, el servidor en el proyecto. */
async function addFolderToProject(p: Project, bookmark: Bookmark): Promise<void> {
  const st = useProfiles.getState();
  const saved = await st.addBookmark(p.id, bookmark);
  // addBookmark ya muestra el error; el servidor va después para que el proyecto quede completo.
  if (!saved || !(await st.addServerToProject(p.id, bookmark.serverId))) return;
  toast.success(`«${basename(bookmark.path) || bookmark.path}» añadida a ${p.name}`);
}

/** Abre el editor de proyectos con el servidor y la carpeta ya puestos. */
function newProjectWith(bookmark: Bookmark): void {
  useUi.getState().openProjectEditor({
    id: "",
    name: "",
    serverIds: [bookmark.serverId],
    bookmarks: [bookmark],
    color: null,
  });
}

function projectItems(bookmark: Bookmark): MenuItem[] {
  const projects = useProfiles.getState().projects;
  const items: MenuItem[] = projects.map((p) => {
    const already = hasBookmark(p, bookmark);
    return {
      label: p.name,
      icon: <span className="fx-menu-chip" style={{ background: p.color ?? undefined }} />,
      disabled: already,
      title: already ? "Esta carpeta ya está en el proyecto" : undefined,
      onSelect: () => void addFolderToProject(p, bookmark),
    };
  });
  if (items.length) items.push({ sep: true });
  items.push({ label: "Nuevo proyecto…", icon: <FolderPlus size={15} />, onSelect: () => newProjectWith(bookmark) });
  return items;
}

/**
 * Entrada «Añadir a proyecto» para la carpeta `path` del servidor guardado `serverId`.
 * Si la conexión no es de un servidor guardado, sale desactivada.
 */
export function addToProjectItem(serverId: string | null, path: string): MenuItem {
  const saved = !!serverId && !!useProfiles.getState().getServer(serverId);
  if (!serverId || !saved) {
    return {
      label: "Añadir a proyecto",
      icon: <FolderKanban size={15} />,
      disabled: true,
      title: "Guarda el servidor para poder añadirlo a un proyecto",
    };
  }
  return {
    label: "Añadir a proyecto",
    icon: <FolderKanban size={15} />,
    submenu: projectItems({ serverId, path, label: null }),
  };
}
