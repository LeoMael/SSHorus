// Acciones de la barra lateral que no dependen de su estado: conectar, borrar, marcadores y exportar.
import type { Project, ServerProfile } from "../../api/types";
import { profiles as profilesApi } from "../../api/profiles";
import { connectToServer, openOrFocusServer } from "../../features/connect";
import { serverAddress } from "../../features/serverMatches";
import { checkSshAliasesBeforeExport } from "../../features/sshAliases";
import { SSH_CONFIG_LABEL } from "../../lib/platform";
import { useProfiles } from "../../stores/profiles";
import { toast } from "../../stores/toasts";
import { confirmDialog, promptDialog } from "../ui/dialogs";
import { validateBookmarkPath } from "./sidebarLogic";

/** Conexión NUEVA (marcadores, «Abrir otra conexión», Ctrl+doble clic, clic central). */
export function connectNew(s: ServerProfile, initialPath?: string | null) {
  void connectToServer(s, initialPath ? { initialPath } : {});
}

/** Va a la pestaña ya abierta del servidor (reconectándola si hace falta) o conecta si no hay. */
export function openOrFocus(s: ServerProfile) {
  void openOrFocusServer(s);
}

export async function deleteServer(s: ServerProfile) {
  const ok = await confirmDialog({
    title: "Eliminar servidor",
    message: (
      <>
        Se eliminará <strong>{s.name}</strong> ({serverAddress(s)}), su contraseña guardada en el llavero y sus marcadores.
        Las conexiones abiertas no se cierran.
      </>
    ),
    confirmText: "Eliminar",
    danger: true,
  });
  if (ok) await useProfiles.getState().deleteServer(s.id);
}

export async function deleteProject(p: Project) {
  const ok = await confirmDialog({
    title: "Eliminar proyecto",
    message: (
      <>
        Se eliminará el proyecto <strong>{p.name}</strong> y sus marcadores. Los servidores no se borran.
      </>
    ),
    confirmText: "Eliminar",
    danger: true,
  });
  if (ok) await useProfiles.getState().deleteProject(p.id);
}

export async function addBookmarkFor(projectId: string, s: ServerProfile) {
  const path = await promptDialog({
    title: "Añadir marcador",
    message: `Carpeta de ${s.name} que se abrirá directamente.`,
    label: "Ruta remota",
    initial: s.defaultPath ?? "/",
    placeholder: "/var/www/app",
    confirmText: "Añadir",
    validate: validateBookmarkPath,
  });
  if (!path) return;
  const ok = await useProfiles.getState().addBookmark(projectId, { serverId: s.id, path: path.trim(), label: null });
  if (ok) toast.success("Marcador añadido");
}

export async function exportSshConfig() {
  if (!(await checkSshAliasesBeforeExport())) return;
  try {
    const r = await profilesApi.exportSshConfig();
    toast.success(r.count === 1 ? `1 servidor exportado a ${r.path}` : `${r.count} servidores exportados a ${r.path}`);
  } catch (e) {
    toast.error(`No se pudo exportar a ${SSH_CONFIG_LABEL}`, e);
  }
}
