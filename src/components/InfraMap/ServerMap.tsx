// Mapa de un servidor (Administración → Mapa). Se lee la primera vez que se abre; al volver se ve lo
// guardado (ver useCachedMap) y se relee con «Actualizar», al reconectar o si tiene más de ~10 min.
import { useCallback } from "react";
import { collectServer } from "../../features/infra/collect";
import type { NavTarget } from "../../features/infra";
import { useInfraNav } from "../../features/infra/store";
import { useProfiles } from "../../stores/profiles";
import { useTabs } from "../../stores/tabs";
import { InfraMapView } from "./InfraMapView";
import { useCachedMap } from "./useCachedMap";

export function ServerMap({ sessionId, profileId, active, disabled }: { sessionId: string; profileId: string; active: boolean; disabled: boolean }) {
  const profile = useProfiles((s) => s.servers.find((x) => x.id === profileId));
  const title = useTabs((s) => s.tabs.find((t) => t.sessionId === sessionId)?.title ?? "servidor");
  const reconnects = useTabs((s) => s.tabs.find((t) => t.sessionId === sessionId)?.reconnectCount ?? 0);
  const name = profile?.name ?? title;
  const host = profile?.host ?? "";
  const key = `server:${sessionId}`;
  const { snapshots, at, loading, refresh } = useCachedMap({
    key,
    token: `${sessionId}#${reconnects}`,
    enabled: active && !disabled,
    load: async () => [await collectServer({ profileId, name, host, sessionId })],
  });
  const nav = useCallback((_server: string, t: NavTarget) => useInfraNav.getState().open(sessionId, t), [sessionId]);
  return (
    <InfraMapView
      key={key}
      cacheKey={key}
      snapshots={snapshots}
      loading={loading}
      updatedAt={at}
      onRefresh={refresh}
      onNav={nav}
      name={`mapa-${name}`}
    />
  );
}
