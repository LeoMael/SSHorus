// En qué orden se prueba a entrar en cada base (funciones puras). Primero lo que no pide contraseña:
// - credencial guardada en SSHorus (si el usuario la guardó, es la que quiere);
// - contenedor: por su socket, con las variables de la propia imagen;
// - servicio del servidor: con sudo, como `postgres` o root (lo más probable que funcione); sin sudo, como
//   el usuario conectado;
// - SQLite: como el usuario conectado y, si no puede leer el archivo, con sudo.
// Si nada sirve, la interfaz pide usuario y contraseña.
import type { DbCredential } from "../../api/db";
import { authFits } from "./scripts";
import type { DbAuth, DbAuthKind, DbTarget } from "./types";

export interface AuthOptions {
  saved: DbCredential | null;
  /** Hay elevación utilizable ahora (root, sudo sin contraseña o con la contraseña ya escrita). */
  canElevate: boolean;
}

export function authPlan(t: DbTarget, o: AuthOptions): DbAuth[] {
  const plan: DbAuth[] = [];
  if (o.saved && authFits(t.engine, t.place, "password")) plan.push({ kind: "password", user: o.saved.user, password: o.saved.password });
  const auto: DbAuthKind[] =
    t.place.kind === "container" ? ["local"] : t.engine === "sqlite" ? ["peer", "service"] : o.canElevate ? ["service", "peer"] : ["peer"];
  for (const kind of auto) {
    if (kind === "service" && !o.canElevate) continue;
    if (authFits(t.engine, t.place, kind)) plan.push({ kind } as DbAuth);
  }
  return plan;
}

/** Hace falta la elevación (sudo) para entrar así. */
export function needsElevation(t: DbTarget, auth: DbAuth): boolean {
  return auth.kind === "service" || (t.place.kind === "container" && t.place.sudo);
}

/** Cómo se entró, en palabras (sin la contraseña). */
export function authLabel(t: DbTarget, auth: DbAuth): string {
  switch (auth.kind) {
    case "password":
      return `como «${auth.user}» (contraseña)`;
    case "local":
      return "dentro del contenedor, sin contraseña";
    case "service":
      return t.engine === "postgres" ? "como el usuario postgres (sudo)" : "como root (sudo)";
    case "peer":
      return "como tu usuario, sin contraseña";
  }
}
