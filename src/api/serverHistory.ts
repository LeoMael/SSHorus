// Historial por servidor: lo que guarda el motor (`src-tauri/src/server_history/`). El resto de la línea de
// tiempo sale de otros registros (Administración, asistente de IA, auditorías, escáner).
import { call } from "./core";

/** terminal = línea escrita (solo si se activó) · library = Biblioteca · multirun = varios servidores · job = tarea. */
export type HistorySource = "terminal" | "library" | "multirun" | "job";

export interface HistoryEvent {
  id: string;
  /** Unix ms. */
  at: number;
  source: HistorySource;
  title: string;
  detail: string;
  /** null = no se sabe (líneas de la terminal). */
  ok: boolean | null;
  result: string;
  serverName: string;
}

export type NewHistoryEvent = Omit<HistoryEvent, "id" | "at">;

export const serverHistory = {
  /** El motor tapa contraseñas y llaves antes de guardar. */
  append: (serverId: string, event: NewHistoryEvent) =>
    call<HistoryEvent>("server_history_append", { serverId, event: { ...event, id: "", at: 0 } }),
  list: (serverId: string) => call<HistoryEvent[]>("server_history_list", { serverId }),
  clear: (serverId: string) => call<void>("server_history_clear", { serverId }),
};
