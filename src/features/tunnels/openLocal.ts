// «Abrir túnel a mi PC» hacia un puerto del servidor: reutiliza (o crea) un túnel local guardado y lo arranca.
// Lo usan Contenedores (puertos publicados), Administración → Puertos y «Servicios que puedes traer».
import { errorMessage } from "../../api/core";
import { tunnels, type TunnelStatus } from "../../api/tunnels";
import { clipboard } from "../../lib/clipboard";
import { toast } from "../../stores/toasts";
import { findLocalTunnel } from "./detect";
import { ensureTunnelEvents, useTunnels } from "./useTunnels";

/**
 * Abre en tu PC un túnel hacia `destHost:destPort` (visto desde el servidor), copia la dirección local
 * y avisa con un mensaje. Escucha en `localPort` si se indica; si no, en el mismo puerto (o en uno libre
 * si es menor de 1024: en tu PC no se pueden abrir puertos bajos sin ser administrador).
 * Devuelve el estado del túnel, o null si falló (ya se avisó).
 */
export async function openLocalTunnel(
  sessionId: string,
  profileId: string,
  destHost: string,
  destPort: number,
  name: string,
  localPort?: number,
): Promise<TunnelStatus | null> {
  try {
    ensureTunnelEvents();
    const store = useTunnels.getState();
    if (!store.defs[profileId]) await store.loadDefs(profileId);
    let def = findLocalTunnel(useTunnels.getState().defs[profileId] ?? [], destHost, destPort);
    if (!def) {
      def = await useTunnels.getState().save({
        id: "",
        profileId,
        name,
        kind: "local",
        bindHost: "127.0.0.1",
        bindPort: localPort ?? (destPort < 1024 ? 0 : destPort),
        destHost,
        destPort,
        autoStart: false,
      });
    }
    const st = await tunnels.start(sessionId, def.id);
    useTunnels.getState().applyStatus(st);
    const addr = `localhost:${st.boundPort ?? def.bindPort}`;
    await clipboard.write(addr).catch(() => {});
    toast.success("Túnel abierto", `Usa ${addr} en tu PC (dirección copiada). Lo verás en Túneles.`);
    return st;
  } catch (e) {
    toast.error("No se pudo abrir el túnel", errorMessage(e));
    return null;
  }
}
