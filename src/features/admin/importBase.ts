// «Añadir a SSHorus»: de qué servidor se copian host y puerto, y qué nombre lleva cada servidor nuevo.
// Funciones puras (sin React ni Tauri).
import type { ServerProfile, SessionInfo } from "../../api/types";
import { findExistingServer } from "./importUsers";

export interface ImportBase {
  base: ServerProfile;
  /** Es un servidor guardado (si no, salió de los datos de la conexión). */
  saved: boolean;
}

type SessionTarget = Pick<SessionInfo, "name" | "host" | "port" | "username">;

/**
 * Servidor de la pestaña: el guardado con su id; si no aparece (lista aún sin cargar, o se borró y se
 * volvió a crear), el guardado con el mismo host, puerto y usuario de la conexión; y si no hay ninguno,
 * uno sin guardar con los datos de la conexión. null = todavía no se sabe nada.
 */
export function resolveImportBase(
  servers: readonly ServerProfile[],
  profileId: string,
  session: SessionTarget | null,
): ImportBase | null {
  const byId = profileId ? servers.find((s) => s.id === profileId) : undefined;
  if (byId) return { base: byId, saved: true };
  if (!session) return null;
  const same = findExistingServer(servers, session.host, session.port, session.username);
  if (same) return { base: same, saved: true };
  return {
    base: {
      id: "",
      name: session.name,
      host: session.host,
      port: session.port,
      username: session.username,
      auth: "password",
      keyPath: null,
      defaultPath: null,
      color: null,
    },
    saved: false,
  };
}

export function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase("es") + s.slice(1) : s;
}

/**
 * Nombre propuesto por usuario: «Ana»; si ya hay un servidor (o otro de la lista) que se llama así,
 * «Ana · host», «Ana · host 2»… Sin distinguir mayúsculas.
 */
export function defaultServerNames(users: readonly string[], host: string, servers: readonly { name: string }[]): Map<string, string> {
  const taken = new Set(servers.map((s) => s.name.trim().toLocaleLowerCase("es")));
  const out = new Map<string, string>();
  for (const u of users) {
    const plain = capitalize(u);
    const withHost = host.trim() ? `${plain} · ${host.trim()}` : plain;
    let name = plain;
    for (let n = 1; taken.has(name.toLocaleLowerCase("es")); n++) name = n === 1 ? withHost : `${withHost} ${n}`;
    taken.add(name.toLocaleLowerCase("es"));
    out.set(u, name);
  }
  return out;
}
