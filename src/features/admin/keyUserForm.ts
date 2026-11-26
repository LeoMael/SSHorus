// Formulario de «Nuevo usuario con clave» (sin React): grupos escritos a mano, shell por defecto y
// qué está mal antes de enseñar el plan.
import type { Toolset } from "./commands";
import { checkPublicKey } from "./keyUser";
import { validateName } from "./shell";

/** «docker, video ,» → ["docker", "video"]. */
export function parseGroupList(text: string): string[] {
  return text
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}

/** bash si lo hay, si no sh; /bin/sh si el servidor no dice cuáles tiene. */
export function defaultShell(shells: string[]): string {
  return shells.find((s) => s.endsWith("/bash")) ?? shells.find((s) => s.endsWith("/sh")) ?? "/bin/sh";
}

export interface KeyUserFormInput {
  name: string;
  /** Usuarios y grupos que ya hay en el servidor. */
  users: string[];
  groups: string[];
  toolset: Toolset;
  /** La llave elegida o por qué falta («Genera la llave primero»). */
  key: { line: string } | string;
  extraGroups: string[];
  /** Resultado de elegir la contraseña de sudo (solo con «Dar sudo»). */
  sudo: { ok: true } | { ok: false; error: string } | null;
}

/** Errores por campo (`name`, `key`, `groups`, `sudo`) y la llave ya limpia si es válida. */
export function validateKeyUserForm(f: KeyUserFormInput): { errors: Record<string, string>; publicKey: string } {
  const errors: Record<string, string> = {};
  const ne = validateName(f.name);
  if (ne) errors.name = ne;
  else if (f.users.includes(f.name)) errors.name = "Ya existe un usuario con ese nombre";
  else if (f.groups.includes(f.name) && f.toolset === "shadow")
    errors.name = "Ya existe un grupo con ese nombre (useradd crea uno igual para el usuario)";

  let publicKey = "";
  if (typeof f.key === "string") errors.key = f.key;
  else {
    const c = checkPublicKey(f.key.line);
    if (!c.ok) errors.key = c.error;
    else publicKey = c.line;
  }

  // Si el servidor no dijo qué grupos tiene, no se puede comprobar que existan.
  const known = new Set(f.groups);
  for (const g of f.extraGroups) {
    const ge = validateName(g, "grupo");
    if (ge) errors.groups = `«${g}»: ${ge}`;
    else if (known.size && !known.has(g)) errors.groups = `El grupo «${g}» no existe en el servidor`;
  }

  if (f.sudo && !f.sudo.ok) errors.sudo = f.sudo.error;
  return { errors, publicKey };
}
