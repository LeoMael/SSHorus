// Por qué no se puede usar «Explicar con IA» ahora mismo (null = se puede; también null si la IA está
// apagada, y entonces el botón no se muestra).
import { useEffect, useState } from "react";
import { ai, type Report } from "../../../api/vulnscan";
import { useLock } from "../../../features/lock/lockStore";
import { useSettings } from "../../../stores/settings";

export function useAiBlock(report: Report | null | undefined): string | null {
  const aiSettings = useSettings((s) => s.settings.ai);
  const locked = useLock((s) => !!s.status?.locked);
  const [aiLocked, setAiLocked] = useState(false);
  useEffect(() => {
    if (!aiSettings.enabled) return;
    ai.status().then(
      (s) => setAiLocked(s.locked),
      () => {},
    );
  }, [aiSettings.enabled, locked]);

  if (!aiSettings.enabled) return null;
  if (locked || aiLocked) return "Desbloquea SSHorus para usar la IA";
  if (!report) return "Primero analiza el servidor";
  if (!aiSettings.baseUrl || !aiSettings.model) return "Falta la URL o el modelo (Ajustes → IA para explicar informes)";
  return null;
}
