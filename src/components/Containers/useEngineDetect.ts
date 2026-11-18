// Detección de Podman / Docker en el servidor: la primera vez que se ve la pestaña y tras reconectar.
import { useCallback, useEffect, useRef, useState } from "react";
import { DETECT_SCRIPT, parseDetect, runRaw, type DetectResult } from "../../features/containers";

export interface DetectState {
  loading: boolean;
  result: DetectResult | null;
  error: string | null;
}

export function useEngineDetect(sessionId: string, active: boolean, disabled: boolean) {
  const [det, setDet] = useState<DetectState>({ loading: false, result: null, error: null });

  const detGen = useRef(0);
  const detect = useCallback(async () => {
    const gen = ++detGen.current;
    setDet((d) => ({ ...d, loading: true, error: null }));
    const r = await runRaw(sessionId, DETECT_SCRIPT, { kind: "none" }, 40);
    if (gen !== detGen.current) return;
    const out = r.result ? parseDetect(r.result.stdout) : null;
    if (out?.ok) setDet({ loading: false, result: out, error: null });
    else setDet({ loading: false, result: null, error: r.error ?? "No se pudo comprobar si hay Podman o Docker en el servidor" });
  }, [sessionId]);

  const wasDisabled = useRef(disabled);
  const detectedOnce = useRef(false);
  useEffect(() => {
    if (disabled) {
      wasDisabled.current = true;
      return;
    }
    // Primera vez que se ve la pestaña, o tras reconectar.
    if ((active && !detectedOnce.current) || (wasDisabled.current && detectedOnce.current)) {
      detectedOnce.current = true;
      wasDisabled.current = false;
      void detect();
    }
  }, [active, disabled, detect]);

  return { det, detect };
}
