// Cuenta atrás de un diálogo del asistente (se deniega solo al llegar a cero).
import { useEffect, useState } from "react";

export function useSecondsLeft(expiresAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}
