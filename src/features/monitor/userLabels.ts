// Textos de cada fila de «Por usuario» (funciones puras): sobre todo, que los uid de los contenedores de
// Podman sin root (números sin nombre) digan de quién son y en qué contenedor corren.
import type { UserContainer, UserUsage } from "./users";

export interface UserRowText {
  /** Lo que se lee en la columna «Usuario». */
  main: string;
  /** Segunda parte, más tenue (p. ej. «de leo_oti · uid 999 dentro»). */
  detail: string | null;
  /** Explicación al pasar el ratón. */
  hint: string;
}

/** Nombre del contenedor, o su id corto si aún no se sabe. */
export const containerName = (c: Pick<UserContainer, "id" | "name">): string => c.name ?? c.id;

/** «a», «a y b», «a, b y 2 más». */
export function listNames(names: string[], max = 2): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= max) return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(", ")} y ${names.length - max} más`;
}

export function userRowText(u: UserUsage, ctx: { hidepid: boolean; elevated: boolean }): UserRowText {
  if (u.uid === null) {
    const sudo = ctx.hidepid && !ctx.elevated;
    return {
      main: "Sin identificar",
      detail: sudo ? "haría falta sudo" : null,
      hint: sudo
        ? "Procesos cuyo dueño no se puede leer sin sudo (este servidor oculta los procesos de los demás)."
        : "Aún no se sabe de quién son: se averigua en la próxima muestra.",
    };
  }
  if (u.sub) {
    const { owner, innerUid } = u.sub;
    const names = u.inContainers.map(containerName);
    const where = names.length === 1 ? "el contenedor" : "los contenedores";
    const hint =
      `El uid ${u.uid} del servidor es el usuario ${innerUid} de dentro de ${where} de ${owner}. ` +
      `Podman sin root reserva a cada usuario un rango de números (en /etc/subuid) para los usuarios de sus ` +
      `contenedores; por eso no tiene nombre en el servidor.`;
    if (!names.length) return { main: `Contenedores de ${owner}`, detail: `uid ${innerUid} dentro`, hint };
    return {
      main: names.length === 1 ? `Contenedor ${names[0]}` : `Contenedores ${listNames(names)}`,
      detail: `de ${owner} · uid ${innerUid} dentro`,
      hint,
    };
  }
  if (u.user === String(u.uid)) {
    return {
      main: `uid ${u.uid}`,
      detail: null,
      hint: `El uid ${u.uid} no tiene nombre en /etc/passwd (puede ser de un contenedor o de un usuario borrado).`,
    };
  }
  return { main: u.user, detail: null, hint: `Ver solo los procesos de ${u.user}` };
}

/** Dueño de los contenedores de una fila (para «Ver en Contenedores»), o null si no tiene. */
export function rowContainerOwner(u: UserUsage): { owner: string | null; engine: UserContainer["engine"] | null } | null {
  if (u.sub) return { owner: u.sub.owner, engine: "podman" };
  const c = u.inContainers[0];
  return c ? { owner: c.owner, engine: c.engine } : null;
}
