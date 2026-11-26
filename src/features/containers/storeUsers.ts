// Usuarios del servidor con almacén de contenedores propio (se leen con sudo). La misma lista y el mismo
// script del motor la usan Contenedores (selector «Usuario»), el mapa, «Bases de datos» y el escáner de
// vulnerabilidades (que la refleja en su store para su pestaña).
import { create } from "zustand";
import { vulnscan, type UsersView } from "../../api/vulnscan";
import { runScript } from "../privileges/run";
import type { Elevation } from "../privileges";

interface StoreUsersState {
  /** Por sesión (sin entrada = aún no se leyó). */
  bySession: Record<string, UsersView | null>;
}

export const useStoreUsers = create<StoreUsersState>(() => ({ bySession: {} }));

/** Lee la lista de usuarios con almacén de contenedores (necesita sudo) y la recuerda para la sesión. */
export async function loadStoreUsers(sessionId: string, el: Elevation): Promise<UsersView> {
  const script = await vulnscan.script({ kind: "users" });
  const r = await runScript(sessionId, script, el, "", 30);
  const u = await vulnscan.parseUsers(r.stdout);
  useStoreUsers.setState((s) => ({ bySession: { ...s.bySession, [sessionId]: u } }));
  return u;
}
