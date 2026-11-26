// Reglas puras del motor de «Ejecutar en varios servidores»: cómo se lee un error de conexión,
// cómo se ve un servidor recién puesto en cola y qué estado deja el resultado de un comando.
import type { ExecResult } from "../../api/types";
import type { SudoWrapFailure } from "../../api/snippets";
import { sudoFailureText } from "../sudoRun/failure";
import type { AttentionKind, TargetInput, TargetState, TargetStatus } from "./types";

export interface ConnectFailure {
  attention: AttentionKind | null;
  message: string;
}

function errKind(e: unknown): string | null {
  if (e && typeof e === "object" && "kind" in e && typeof (e as { kind: unknown }).kind === "string") {
    return (e as { kind: string }).kind;
  }
  return null;
}

export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Error desconocido";
}

/** Traduce un error de conexión sin interacción a "requiere atención" o a error definitivo. */
export function classifyConnectError(e: unknown, auth: TargetInput["auth"]): ConnectFailure {
  switch (errKind(e)) {
    case "NeedsPassword":
      return { attention: "password", message: "Falta la contraseña (no está guardada)" };
    case "NeedsPassphrase":
      return { attention: "passphrase", message: "Falta la frase de la llave" };
    case "NeedsOtp":
      return { attention: "otp", message: "Pide un código de verificación (2FA)" };
    case "HostKeyUnknown":
      return { attention: "hostkey", message: "Servidor desconocido: hay que confirmar su huella" };
    case "HostKeyChanged":
      return { attention: "hostkey-changed", message: "¡La huella del servidor cambió! Revísala antes de continuar" };
    case "AuthFailed":
      if (auth === "password") return { attention: "auth", message: "La contraseña guardada fue rechazada" };
      return { attention: null, message: `Autenticación fallida: ${errText(e)}` };
    default:
      return { attention: null, message: errText(e) };
  }
}

/** Estado de un servidor que aún no ha empezado. */
export function blankTarget(t: TargetInput): TargetState {
  return {
    ...t,
    status: "queued",
    detail: null,
    attention: null,
    sessionId: null,
    owned: false,
    reused: false,
    connectStartedAt: null,
    execStartedAt: null,
    finishedAt: null,
    result: null,
    privilege: null,
  };
}

export type ExecOutcome = ExecResult & { sudoFailure?: SudoWrapFailure | null };

/** Estado final y explicación según cómo terminó el comando. */
export function execOutcome(r: ExecOutcome, timeoutSecs: number): { status: TargetStatus; detail: string | null } {
  if (r.sudoFailure) return { status: "error", detail: sudoFailureText(r.sudoFailure) };
  if (r.timedOut) return { status: "timeout", detail: `Sin terminar tras ${timeoutSecs} s` };
  if (r.exitCode === null) return { status: "error", detail: "El comando terminó sin código de salida" };
  return { status: r.exitCode === 0 ? "ok" : "error", detail: null };
}
