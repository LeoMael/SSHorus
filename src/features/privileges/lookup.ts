// De dónde sale la contraseña de sudo de una conexión: un solo orden para todos los paneles que elevan
// (Administración, Contenedores, escáner). Funciones puras, sin React ni Tauri, para poder probarlas.
//
// Orden:
//  1. La de esta conexión en memoria (ya comprobada con sudo).
//  2. La guardada del servidor (bóveda con PIN o llavero; o la de la conexión si el servidor dice
//     «La de la conexión»). Se comprueba con `sudo -v` antes de usarla.
//  3. La de otra pestaña abierta al mismo servidor (mismo perfil: mismo usuario y host).
//  4. Preguntar al usuario.
// Si el usuario pulsó «Olvidar», no se vuelve a mirar la guardada ni las de otras pestañas hasta reconectar.
// Si sudo la rechazó («failed»/«rejected»), tampoco: cada intento fallido cuenta y puede bloquear la cuenta.
import type { ServerProfile, SudoMode } from "../../api/types";
import type { PrivilegeInfo } from "./detect";

/**
 * Contraseña guardada de la sesión: "loading" leyendo/comprobando, "ok" en memoria, "none" no hay o
 * el servidor dice «Pedir cada vez», "retry" no se pudo usar por un error pasajero (llavero o bóveda no
 * disponible, sudo tardó, red), "failed" sudo la rechazó (aún sin avisar), "rejected" sudo la rechazó y
 * el usuario ya vio el aviso (no se vuelve a abrir el diálogo solo), "off" el usuario la olvidó a mano.
 */
export type StoredSudoState = "loading" | "ok" | "none" | "retry" | "failed" | "rejected" | "off";

export type SudoSource = "memory" | "stored" | "other-session" | "ask";

export interface SudoLookupInput {
  /** Esta conexión ya tiene la contraseña en memoria. */
  hasMemory: boolean;
  stored: StoredSudoState | undefined;
  /** Ajuste del servidor («Pedir cada vez», «La de la conexión», «Guardar»). */
  mode: SudoMode;
  /** Otras pestañas abiertas al mismo servidor con la contraseña en memoria. */
  otherSessions: number;
  /** Lo pide el diálogo, justo antes de preguntar: vuelve a mirar aunque antes no hubiera guardada. */
  fromDialog?: boolean;
}

/** ¿Se lee (otra vez) la guardada? Nunca si sudo ya la rechazó o el usuario la olvidó. */
function readStored(st: StoredSudoState | undefined, fromDialog: boolean): boolean {
  switch (st) {
    case undefined:
    case "loading":
    case "ok":
    case "retry":
      return true;
    case "none":
      // Los paneles no la releen cada vez que se abren; el diálogo sí (quizá se acaba de guardar).
      return fromDialog;
    default:
      return false;
  }
}

/** Pasos a probar, en orden. Siempre termina en "ask" salvo si ya está en memoria. */
export function sudoLookupPlan(i: SudoLookupInput): SudoSource[] {
  if (i.hasMemory) return ["memory"];
  if (i.stored === "off") return ["ask"];
  const plan: SudoSource[] = [];
  if (i.mode !== "ask" && readStored(i.stored, !!i.fromDialog)) plan.push("stored");
  if (i.otherSessions > 0) plan.push("other-session");
  plan.push("ask");
  return plan;
}

/** Estado de la guardada tras comprobarla con sudo. Un fallo pasajero (tiempo, red) se reintenta. */
export function storedStateAfterConfirm(r: { ok: boolean; badPassword?: boolean; transient?: boolean }): StoredSudoState {
  return r.ok ? "ok" : r.badPassword ? "failed" : r.transient ? "retry" : "none";
}

/**
 * Al guardar el servidor o al desbloquear SSHorus, ¿se vuelve a mirar la guardada? Sí si no había o falló
 * por algo pasajero. Si sudo la rechazó, solo si cambió la contraseña de sudo o su modo (si no, sería otro
 * intento fallido con la misma). Nunca si se está leyendo, ya está en memoria o el usuario pulsó
 * «Olvidar» en esa pestaña.
 */
export function resetStoredState(st: StoredSudoState | undefined, sudoChanged: boolean): boolean {
  return st === "none" || st === "retry" || (sudoChanged && (st === "failed" || st === "rejected"));
}



/**
 * ¿Cambió de dónde sale la contraseña de sudo al guardar el servidor? Modo, contraseña de sudo nueva o,
 * con «La de la conexión», la contraseña o el método de la conexión. `prev` undefined = servidor nuevo.
 */
export function sudoSourceChanged(
  prev: Pick<ServerProfile, "auth" | "sudoMode"> | undefined,
  next: Pick<ServerProfile, "auth" | "sudoMode">,
  edits: { secret?: string; sudoSecret?: string },
): boolean {
  if (!prev || edits.sudoSecret !== undefined) return true;
  if ((prev.sudoMode ?? "ask") !== (next.sudoMode ?? "ask")) return true;
  return next.sudoMode === "login" && (edits.secret !== undefined || prev.auth !== next.auth);
}

/** La guardada (o la de la conexión) no sirvió para sudo. */
export function storedFailed(st: StoredSudoState | undefined): boolean {
  return st === "failed" || st === "rejected";
}

/** «Guardar para este servidor» marcado de entrada: al cambiarla, si la guardada falló o si el
 * servidor ya usa una guardada (o la de la conexión). */
export function defaultSaveChecked(o: { change: boolean; failed: boolean; mode: SudoMode }): boolean {
  return o.change || o.failed || o.mode !== "ask";
}

/** Contraseñas en memoria de otras pestañas abiertas al mismo servidor (sin repetir). */
export function otherSessionPasswords(
  tabs: readonly { sessionId: string; profileId: string; status: string }[],
  bySession: Readonly<Record<string, string>>,
  sessionId: string,
  profileId: string,
): string[] {
  const out: string[] = [];
  for (const t of tabs) {
    if (t.sessionId === sessionId || t.profileId !== profileId || t.status === "closed") continue;
    const pw = bySession[t.sessionId];
    if (pw !== undefined && !out.includes(pw)) out.push(pw);
  }
  return out;
}

/**
 * Un comando con sudo de fuera de los paneles (el asistente de IA, por MCP): ¿hay que darle la contraseña?
 * No con root ni con sudo sin contraseña, ni si el servidor no tiene sudo. Si no se pudo comprobar, sí
 * (si sobra, sudo lo dirá).
 */
export function sudoPasswordNeeded(info: Pick<PrivilegeInfo, "level" | "hasSudo">): boolean {
  if (info.level === "root" || info.level === "sudo-nopasswd") return false;
  return info.level === "unknown" || info.hasSudo;
}
