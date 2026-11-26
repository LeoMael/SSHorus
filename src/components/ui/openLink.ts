// Abrir un enlace en el navegador del sistema (con aviso si no se puede).
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "../../stores/toasts";

export function openLink(url: string) {
  openUrl(url).catch((e) => toast.error("No se pudo abrir el enlace", e));
}
