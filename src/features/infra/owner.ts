// Mapa de infraestructura: de quién es cada cosa (en qué caja va). Funciones puras.
// Sin sudo solo se ven los procesos propios: lo que no se puede atribuir va a «Sin identificar», nunca
// a la caja del usuario conectado.

/** Lo que corre como root o como usuarios del sistema (www-data, postgres…). */
export const SYSTEM_OWNER = "sistema";
/** Sin sudo no se sabe de quién es (p. ej. un puerto sin proceso visible). */
export const UNKNOWN_OWNER = "sin identificar";
/** «Lo mío»: lo de otros por donde se llega desde Internet a lo del usuario (puerto, proxy, sitio). */
export const ROUTE_OWNER = "ruta";

/** Lo que se sabe del dueño de un elemento del mapa. */
export type OwnerEvidence =
  /** Usuario de un proceso, contenedor o archivo («root» si es rootful); null = no se pudo ver. */
  | { kind: "account"; user: string | null }
  /** Servicio systemd: del sistema o de `systemctl --user` de `user`. */
  | { kind: "unit"; scope: "system" | "user"; user: string | null }
  /** Del sistema por naturaleza (cortafuegos). */
  | { kind: "system" };

export interface OwnerContext {
  me: string | null;
  /** Se leyó con root o sudo: se ven los procesos de todos. */
  seesAll: boolean;
  /** Usuarios de personas (uid ≥ 1000); vacío o null si no se pudieron leer. */
  humans: { has(name: string): boolean; size: number } | null;
}

/** Caja en la que va un elemento: la de su usuario, «sistema» o «sin identificar». */
export function resolveOwner(ev: OwnerEvidence, ctx: OwnerContext): string {
  if (ev.kind === "system" || (ev.kind === "unit" && ev.scope === "system")) return SYSTEM_OWNER;
  const user = ev.user;
  // Con sudo se ve todo: lo que no tiene proceso es del núcleo (NFS, WireGuard…).
  if (!user) return ctx.seesAll ? SYSTEM_OWNER : UNKNOWN_OWNER;
  if (user === "root" || user === SYSTEM_OWNER) return SYSTEM_OWNER;
  if (ctx.humans && ctx.humans.size > 0) return ctx.humans.has(user) ? user : SYSTEM_OWNER;
  return user === ctx.me ? user : SYSTEM_OWNER;
}

const OWNER_TEXT: Record<string, { band: string; chip: string }> = {
  [SYSTEM_OWNER]: { band: "Sistema", chip: "Sistema" },
  [UNKNOWN_OWNER]: { band: "Sin identificar (haría falta sudo)", chip: "Sin identificar" },
  [ROUTE_OWNER]: { band: "Del sistema · camino desde Internet", chip: "Del sistema" },
};

/** Título de la caja (`chip`: versión corta para los filtros). */
export function ownerLabel(owner: string, chip = false): string {
  const t = OWNER_TEXT[owner];
  return t ? (chip ? t.chip : t.band) : owner;
}

/** «sistema» primero, luego el usuario conectado, el resto por orden alfabético y «sin identificar» al final. */
export function sortOwners(owners: string[], me: string | null): string[] {
  const rank = (o: string) => (o === SYSTEM_OWNER ? 0 : o === me ? 1 : o === UNKNOWN_OWNER ? 3 : 2);
  return [...new Set(owners)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Aviso del mapa cuando no se leyó con sudo. */
export const NO_SUDO_NOTE = "Sin sudo solo se sabe con certeza lo tuyo";

/**
 * Dueño de nginx o Caddy por cómo está instalado: con unidad systemd del sistema, «sistema»; si no, el
 * dueño de su archivo de configuración. null = no se sabe por ahí (se mira el proceso que escucha).
 */
export function webServerOwner(w: { status: string | null; configOwner: string | null }, ctx: OwnerContext): string | null {
  if (w.status !== null) return SYSTEM_OWNER;
  return w.configOwner ? resolveOwner({ kind: "account", user: w.configOwner }, ctx) : null;
}
