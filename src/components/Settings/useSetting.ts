// Un ajuste y su función para cambiarlo (se guarda con retardo en useSettings().update).
import { useSettings } from "../../stores/settings";
import type { Settings } from "../../api/types";

export function useSetting<K extends keyof Settings>(key: K): [Settings[K], (v: Settings[K]) => void] {
  const value = useSettings((s) => s.settings[key]);
  const update = useSettings((s) => s.update);
  return [value, (v) => update({ [key]: v } as Partial<Settings>)];
}
