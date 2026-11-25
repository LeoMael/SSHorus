// Marca de sudo de cada servidor guardado en la barra lateral: lo detectado en sus conexiones abiertas,
// si no lo último que se vio, si no lo que dice el perfil (ver resolveSudo).
import { useMemo } from "react";
import type { ServerProfile } from "../../api/types";
import { accountAdmin, knownAdminFor, useKnownAdmin, usePrivileges, type AccountAdmin } from "../../features/privileges";
import { bestAdmin, resolveSudo, type SudoBadge } from "../../features/sidebar/machineGroups";
import { useTabs } from "../../stores/tabs";

export function useAccountSudo(servers: readonly ServerProfile[]): ReadonlyMap<string, SudoBadge | null> {
  const bySession = usePrivileges((s) => s.bySession);
  const known = useKnownAdmin((s) => s.byProfile);
  // «sesión perfil» por línea: cambiar de pestaña no cambia el texto (no redibuja la barra).
  const sessionsKey = useTabs((s) => s.tabs.map((t) => `${t.sessionId} ${t.profileId}`).join("\n"));

  return useMemo(() => {
    const live = new Map<string, (AccountAdmin | null)[]>();
    for (const line of sessionsKey ? sessionsKey.split("\n") : []) {
      const [sessionId, profileId] = line.split(" ");
      const info = bySession[sessionId];
      if (info) live.set(profileId, [...(live.get(profileId) ?? []), accountAdmin(info.level)]);
    }
    return new Map(
      servers.map((s) => [
        s.id,
        resolveSudo(bestAdmin(live.get(s.id) ?? []), knownAdminFor(known[s.id], s.username), s),
      ]),
    );
  }, [servers, bySession, known, sessionsKey]);
}
