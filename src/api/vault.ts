// Bóveda de contraseñas y bloqueo con PIN o contraseña (motor: src-tauri/src/storage/vault.rs y lock.rs).
import { call } from "./core";

/** Payload: `VaultStatus`. Llega a todas las ventanas cuando se bloquea, desbloquea, crea, cambia o quita. */
export const EV_VAULT_STATE = "vault://state";

export interface VaultStatus {
  /** Hay bóveda (si no, las contraseñas van al llavero del sistema). */
  enabled: boolean;
  /** Hay bóveda y falta el PIN o la contraseña. */
  locked: boolean;
  /** Segundos que faltan para poder volver a probar (0 = ya). */
  retryAfterSecs: number;
  /** Qué se pide para abrir. */
  pinKind: PinKind;
}

/** "pin6": PIN de 6 números. "password": contraseña (8 caracteres o más). "text": bóvedas antiguas,
 * PIN escrito en un campo de texto. */
export type PinKind = "pin6" | "password" | "text";

/** Lo que se puede elegir al crear o cambiar. */
export type NewPinKind = Exclude<PinKind, "text">;

export interface MoveReport {
  /** Contraseñas movidas. */
  moved: number;
  /** Al activar: copias que no se pudieron borrar del llavero (siguen allí). */
  leftInKeyring: number;
}

/** Números del PIN. */
export const PIN_LENGTH = 6;
/** Caracteres mínimos de una contraseña. */
export const PASSWORD_MIN_LENGTH = 8;

/** PIN nuevo válido: exactamente 6 números. */
export function isValidPin(pin: string): boolean {
  return new RegExp(`^[0-9]{${PIN_LENGTH}}$`).test(pin);
}

export const vault = {
  status: () => call<VaultStatus>("vault_status"),
  unlock: (pin: string) => call<VaultStatus>("vault_unlock", { pin }),
  lock: () => call<void>("vault_lock"),
  /** El usuario hizo algo: reinicia la cuenta de inactividad. */
  activity: () => call<void>("vault_activity"),
  /** Crea la bóveda (con PIN o contraseña) y mueve a ella las contraseñas del llavero. */
  enable: (pin: string, kind: NewPinKind) => call<MoveReport>("vault_enable", { pin, kind }),
  /** Quita la bóveda y devuelve las contraseñas al llavero. */
  disable: (pin: string) => call<MoveReport>("vault_disable", { pin }),
  /** Cambia el PIN o la contraseña, o pasa de uno a otro. */
  changePin: (oldPin: string, newPin: string, newKind: NewPinKind) =>
    call<void>("vault_change_pin", { oldPin, newPin, newKind }),
  /** «Olvidé mi PIN»: borra la bóveda (se pierden las contraseñas guardadas). */
  reset: () => call<void>("vault_reset"),
};
