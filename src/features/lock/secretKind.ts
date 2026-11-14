// Lógica pura del PIN o la contraseña de la bóveda: textos según el tipo y reglas de lo nuevo.
// Sin React: se prueba aparte (secretKind.test.ts).
import { isValidPin, PASSWORD_MIN_LENGTH, PIN_LENGTH, type NewPinKind, type PinKind } from "../../api/vault";

/** Textos que cambian según se use PIN o contraseña. */
export interface SecretWords {
  /** «PIN» / «contraseña» (en medio de una frase). */
  noun: string;
  /** «PIN» / «Contraseña» (al empezar). */
  Noun: string;
  /** «tu PIN» / «tu contraseña». */
  your: string;
  wrong: string;
  forgot: string;
  current: string;
  /** Avisos al terminar: «PIN creado» / «Contraseña creada»… */
  created: string;
  changed: string;
  removed: string;
}

const PIN_WORDS: SecretWords = {
  noun: "PIN",
  Noun: "PIN",
  your: "tu PIN",
  wrong: "PIN incorrecto.",
  forgot: "Olvidé mi PIN",
  current: "PIN actual",
  created: "PIN creado",
  changed: "PIN cambiado",
  removed: "PIN quitado",
};

const PASSWORD_WORDS: SecretWords = {
  noun: "contraseña",
  Noun: "Contraseña",
  your: "tu contraseña",
  wrong: "Contraseña incorrecta.",
  forgot: "Olvidé mi contraseña",
  current: "Contraseña actual",
  created: "Contraseña creada",
  changed: "Contraseña cambiada",
  removed: "Contraseña quitada",
};

/** Textos para ese tipo. Las bóvedas antiguas ("text") se llaman PIN, como siempre. */
export function secretWords(kind: PinKind | undefined): SecretWords {
  return kind === "password" ? PASSWORD_WORDS : PIN_WORDS;
}

/** Tipo que se propone al cambiar: el mismo, salvo las antiguas ("text"), que pasan a PIN. */
export function defaultNewKind(kind: PinKind | undefined): NewPinKind {
  return kind === "password" ? "password" : "pin6";
}

/** Contraseña nueva válida: 8 caracteres o más, no solo espacios. */
export function isValidPassword(p: string): boolean {
  return [...p].length >= PASSWORD_MIN_LENGTH && p.trim() !== "";
}

/** Comprueba el PIN o la contraseña nuevos y su repetición. Devuelve el problema o null. */
export function checkNewPair(kind: NewPinKind, value: string, again: string): string | null {
  if (kind === "pin6") {
    if (!isValidPin(value)) return `El PIN debe tener ${PIN_LENGTH} números.`;
    if (value !== again) return "Los dos PIN no coinciden.";
    return null;
  }
  if (!isValidPassword(value)) return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (value !== again) return "Las dos contraseñas no coinciden.";
  return null;
}
