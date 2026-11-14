// «Lo mío» / «Todo el servidor» elegido en el mapa, por servidor (id del perfil). Se guarda en este equipo
// (localStorage): solo afecta a la interfaz.
import { create } from "zustand";
import type { MapScope } from "./scope";

const KEY = "sshorus.infra.scope";

function load(): Record<string, MapScope> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!v || typeof v !== "object") return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, MapScope] => e[1] === "mine" || e[1] === "all"));
  } catch {
    return {};
  }
}

export const useMapScopes = create<{ chosen: Record<string, MapScope> }>(() => ({ chosen: load() }));

export function setMapScope(serverIds: string[], scope: MapScope): void {
  const chosen = { ...useMapScopes.getState().chosen };
  for (const id of serverIds) chosen[id] = scope;
  useMapScopes.setState({ chosen });
  try {
    localStorage.setItem(KEY, JSON.stringify(chosen));
  } catch {
    /* sin almacenamiento: vale solo para esta sesión */
  }
}
