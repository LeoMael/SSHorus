// «Nuevo usuario con clave» con sudo: contraseña solo para sudo (generada o escrita) y el servidor que se
// guarda en SSHorus para ese usuario. Funciones puras (sin React ni Tauri).
import type { AuthMethod, ServerProfile } from "../../api/types";
import { generatePassword, validatePassword } from "./shell";

export type SudoPassMode = "generate" | "type";

/**
 * Contraseña de sudo que se usará. «generate»: la ya generada o una nueva (se genera una vez y se reutiliza
 * si se vuelve atrás); «type»: la escrita, validada como cualquier contraseña de usuario.
 */
export function pickSudoPassword(
  mode: SudoPassMode,
  typed: string,
  generated: string,
  generate: () => string = generatePassword,
): { ok: true; password: string } | { ok: false; error: string } {
  if (mode === "generate") return { ok: true, password: generated || generate() };
  const err = validatePassword(typed);
  return err ? { ok: false, error: err } : { ok: true, password: typed };
}

/**
 * Servidor para el usuario nuevo (copia del actual con su usuario y su llave). Con contraseña de sudo, el
 * modo «Guardar» y la contraseña aparte (`sudoSecret`) para `saveServer`; sin ella, «Pedir cada vez».
 */
export function keyUserServer(
  base: ServerProfile,
  user: string,
  keyPath: string,
  sudoPassword: string | null,
): { server: ServerProfile; sudoSecret?: string } {
  const auth: AuthMethod = keyPath ? "key" : "agent";
  const server: ServerProfile = {
    ...base,
    id: "",
    name: `${base.name} (${user})`,
    username: user,
    auth,
    keyPath: keyPath || null,
    sudoMode: sudoPassword ? "saved" : "ask",
  };
  return sudoPassword ? { server, sudoSecret: sudoPassword } : { server };
}
