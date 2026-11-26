// Lectura de usuarios y grupos del servidor (como usuario normal) y, si hay elevación, de /etc/shadow.
import { useCallback, useRef, useState } from "react";
import { errorMessage } from "../../api/core";
import { readServer, readShadow, type ReadResult, type ShadowEntry } from "../../features/admin";
import { ElevationError, refreshPrivilege, sudoRejected, type Elevation } from "../../features/privileges";

export function useServerRead(sessionId: string, elevation: Elevation | null) {
  const [read, setRead] = useState<ReadResult | null>(null);
  const [shadow, setShadow] = useState<Map<string, ShadowEntry> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shadowError, setShadowError] = useState<string | null>(null);
  // Solo cuenta la última lectura: si se lanzan dos seguidas, la vieja se descarta al llegar.
  const gen = useRef(0);

  const load = useCallback(async () => {
    const g = ++gen.current;
    setLoading(true);
    setError(null);
    try {
      const r = await readServer(sessionId);
      if (g !== gen.current) return;
      setRead(r);
      if (elevation) {
        try {
          const s = await readShadow(sessionId, elevation);
          if (g !== gen.current) return;
          setShadow(s);
          setShadowError(null);
        } catch (e) {
          if (g !== gen.current) return;
          setShadow(null);
          setShadowError(errorMessage(e));
          if (e instanceof ElevationError && e.failure === "need-password") refreshPrivilege(sessionId);
          if (e instanceof ElevationError && e.failure === "bad-password") sudoRejected(sessionId);
        }
      } else {
        setShadow(null);
        setShadowError(null);
      }
    } catch (e) {
      if (g !== gen.current) return;
      setError(errorMessage(e));
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [sessionId, elevation]);

  return { read, shadow, loading, error, shadowError, load };
}
