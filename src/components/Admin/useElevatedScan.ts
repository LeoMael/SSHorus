// Lectura elevada (puertos, sitios web) con vuelta a sin root si no se puede; conserva el último
// resultado al cambiar de sub-pestaña.
import { useCallback, useRef, useState } from "react";
import { errorMessage } from "../../api/core";
import { readElevated, refreshPrivilege, sudoRejected, type Elevation } from "../../features/privileges";
import type { ScanState } from "./context";

const EMPTY_SCAN = { data: null, loading: false, error: null, elevated: false, elevationError: null };

export function useElevatedScan<T>(
  sessionId: string,
  elevation: Elevation | null,
  script: string,
  parse: (stdout: string) => T,
  timeoutSecs: number,
): [ScanState<T>, () => Promise<void>] {
  const [state, setState] = useState<ScanState<T>>(EMPTY_SCAN);
  // Solo cuenta la última lectura: si se lanzan dos seguidas, la vieja se descarta al llegar.
  const gen = useRef(0);
  const load = useCallback(async () => {
    const g = ++gen.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await readElevated(sessionId, script, elevation, timeoutSecs);
      if (g !== gen.current) return;
      if (r.elevationError?.failure === "need-password") refreshPrivilege(sessionId);
      if (r.elevationError?.failure === "bad-password") sudoRejected(sessionId);
      setState({
        data: parse(r.result.stdout),
        loading: false,
        error: null,
        elevated: r.elevated,
        elevationError: r.elevationError ? r.elevationError.message : null,
      });
    } catch (e) {
      if (g !== gen.current) return;
      setState((s) => ({ ...s, loading: false, error: errorMessage(e) }));
    }
  }, [sessionId, elevation, script, parse, timeoutSecs]);
  return [state, load];
}
