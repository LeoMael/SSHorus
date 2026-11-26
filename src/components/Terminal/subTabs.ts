// Sub-pestañas de terminal de una conexión: cómo se crean y cuáles se abren al principio.
import type { TermStatus } from "../../features/terminal";
import { useTabs } from "../../stores/tabs";
import { getTmuxMode } from "../../features/tmux/index";
import { isSshorusName, newTmuxName } from "../../features/tmux";

export interface SubTab {
  key: number;
  num: number;
  status: TermStatus;
  /** Sesión tmux propia (null = shell normal). Estable: la reconexión vuelve a ella. */
  tmux: string | null;
  /** Volcar su historial al abrir (se reabre una sesión que ya existía). */
  replay: boolean;
  /** La shell corre de verdad dentro de tmux (el servidor lo tiene). */
  persistent: boolean;
}

let keySeq = 0;
export const newTab = (num: number, tmux: string | null, replay = false): SubTab => ({
  key: ++keySeq,
  num,
  status: "opening",
  tmux,
  replay,
  persistent: false,
});

/** Terminales iniciales: las que hay que reabrir (botón «Reconectar») o una nueva. */
export function initialTabs(sessionId: string, disabled: boolean): SubTab[] {
  if (disabled) return [];
  const tab = useTabs.getState().tabs.find((t) => t.sessionId === sessionId);
  const mode = getTmuxMode(tab?.profileId ?? null);
  const restore = mode === "never" ? [] : (tab?.restoreTerminals ?? []).filter(isSshorusName);
  if (restore.length > 0) return restore.map((name, i) => newTab(i + 1, name, true));
  return [newTab(1, mode === "never" ? null : newTmuxName())];
}
