// Monta el «Historial» de un servidor cuando está abierto (se carga al usarse). App lo monta una vez.
// Para abrirlo: openServerHistory(serverId) de features/serverHistory/store.
import { Suspense } from "react";
import { useServerHistoryDialog } from "../../features/serverHistory/store";
import { preloadable } from "../../lib/lazy";

const ServerHistoryDialog = preloadable(() => import("./ServerHistoryDialog").then((m) => m.ServerHistoryDialog));

export function ServerHistoryHost() {
  const serverId = useServerHistoryDialog((s) => s.serverId);
  if (!serverId) return null;
  return (
    <Suspense fallback={null}>
      <ServerHistoryDialog key={serverId} serverId={serverId} />
    </Suspense>
  );
}
