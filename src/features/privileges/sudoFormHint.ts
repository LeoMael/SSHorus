// Reglas puras de la sección «Contraseña de sudo» del formulario de servidor: qué modo mostrar, qué modo
// guardar y qué texto poner debajo. Sin React ni motor, para poder probarlas (sudoFormHint.test.ts).
import type { AuthMethod, SudoMode } from "../../api/types";

/** Explicación de cada modo (la que se ve debajo cuando no hay nada más que decir). */
export const SUDO_MODE_HINTS: Record<SudoMode, string> = {
  ask: "Se pide al administrar y se olvida al cerrar la conexión.",
  login: "Usa la contraseña de arriba (tiene que estar guardada).",
  saved: "Útil si entras con llave SSH: sudo sigue pidiendo tu contraseña.",
};

/** Modos que se pueden elegir: «La de la conexión» solo si se entra con contraseña. */
export function sudoModesFor(auth: AuthMethod): SudoMode[] {
  return auth === "password" ? ["ask", "login", "saved"] : ["ask", "saved"];
}

/** Modo que muestra el formulario: «login» sin contraseña de conexión (llave o agente) es «Pedir cada vez». */
export function shownSudoMode(mode: SudoMode, auth: AuthMethod): SudoMode {
  return mode === "login" && auth !== "password" ? "ask" : mode;
}

export interface SudoFormState {
  mode: SudoMode;
  auth: AuthMethod;
  /** Hay contraseña de sudo escrita en el campo. */
  typed: boolean;
  /** Hay contraseña de sudo guardada. null = aún no se sabe (cargando o llavero no disponible). */
  stored: boolean | null;
  /** «Guardar contraseña» de la conexión marcado. */
  rememberLogin: boolean;
}

/** «Guardar» sin contraseña escrita ni guardada (si no se sabe si hay una guardada, no se avisa). */
export function sudoSecretMissing(s: SudoFormState): boolean {
  return shownSudoMode(s.mode, s.auth) === "saved" && !s.typed && s.stored === false;
}

/** Modo que se guarda: «Guardar» sin contraseña queda como «Pedir cada vez» (es lo que haría igual). */
export function sudoModeToSave(s: SudoFormState): SudoMode {
  return sudoSecretMissing(s) ? "ask" : shownSudoMode(s.mode, s.auth);
}

/** Texto bajo el selector de sudo. `warn`: se muestra como aviso. */
export function sudoFormHint(s: SudoFormState): { text: string; warn: boolean } {
  const mode = shownSudoMode(s.mode, s.auth);
  if (sudoSecretMissing(s)) return { text: "Escribe la contraseña de sudo o te la pediremos cada vez.", warn: true };
  if (mode === "ask" && s.auth !== "password") {
    const how = s.auth === "key" ? "llave SSH" : "agente SSH";
    return {
      text: `Entras con ${how}: no hay contraseña de conexión. Si quieres que sudo no te la pida, elige «Guardar».`,
      warn: false,
    };
  }
  if (mode === "login" && !s.rememberLogin) return { text: "Marca «Guardar contraseña» para usarla con sudo.", warn: false };
  return { text: SUDO_MODE_HINTS[mode], warn: false };
}
