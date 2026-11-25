// Lee las reglas del cortafuegos del servidor del nodo elegido (con sudo si lo hay) y las vuelve a leer
// al cambiar la elevación o al terminar un cambio del cortafuegos en esa conexión.
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/core";
import type { ServerSnapshot } from "../../features/infra/graph";
import { FIREWALL_JOB, readFirewall, type FirewallRead } from "../../features/infra/firewall";
import { onJobFinished } from "../../features/jobs";
import { useElevation, usePrivilege, useStoredSudo } from "../../features/privileges";
import { useProfiles } from "../../stores/profiles";

export function useFirewall(snap: ServerSnapshot) {
  const sessionId = snap.sessionId ?? "";
  const profileId = snap.id;
  const info = usePrivilege(sessionId);
  const elev = useElevation(sessionId, info);
  useStoredSudo(sessionId, profileId, info, !!sessionId);
  const profilePort = useProfiles((s) => s.servers.find((x) => x.id === profileId)?.port ?? 22);
  const ports = snap.ports;
  const elevation = elev.elevation;

  const [data, setData] = useState<FirewallRead | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);

  const load = useCallback(async () => {
    if (!sessionId) return;
    const g = ++gen.current;
    setLoading(true);
    setError(null);
    try {
      const r = await readFirewall(sessionId, elevation, profilePort, ports);
      if (g === gen.current) setData(r);
    } catch (e) {
      if (g === gen.current) setError(errorMessage(e));
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [sessionId, elevation, profilePort, ports]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      onJobFinished((j) => {
        if (j.kind === FIREWALL_JOB && j.sessionId === sessionId) void load();
      }),
    [sessionId, load],
  );

  return { data, loading, error, reload: load, elev, info, sessionId, profileId };
}
