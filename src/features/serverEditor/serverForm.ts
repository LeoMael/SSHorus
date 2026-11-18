// Reglas puras del formulario de servidor: valores iniciales, validación, armado del perfil y qué hacer
// con los secretos al guardar. Sin React ni motor, para poder probarlas (serverForm.test.ts).
import type { AuthMethod, ServerProfile, SudoMode, TmuxMode } from "../../api/types";
import type { TestSecrets } from "../serverTest";
import { shownSudoMode, sudoModeToSave, type SudoFormState } from "../privileges/sudoFormHint";

export interface ServerFormFields {
  name: string;
  host: string;
  /** Tal como se escribe (solo dígitos). */
  port: string;
  username: string;
  auth: AuthMethod;
  /** Contraseña o frase de la llave escrita (solo en memoria). */
  secret: string;
  /** «Guardar contraseña» / «Guardar la frase». */
  remember: boolean;
  keyPath: string;
  defaultPath: string;
  color: string | null;
  /** null = usar el ajuste general. */
  tmux: TmuxMode | null;
  projectId: string;
  sudoMode: SudoMode;
  sudoSecret: string;
}

export type FormErrors = Partial<Record<"name" | "host" | "port" | "username" | "keyPath" | "alias", string>>;

/** Texto del campo cuando ya hay un secreto guardado. */
export const SAVED_SECRET_PLACEHOLDER = "•••••• (guardada; escribe para cambiarla)";

export function initialFields(initial: ServerProfile | null, projectId: string): ServerFormFields {
  return {
    name: initial?.name ?? "",
    host: initial?.host ?? "",
    port: String(initial?.port ?? 22),
    username: initial?.username ?? "",
    auth: initial?.auth ?? "password",
    secret: "",
    remember: true,
    keyPath: initial?.keyPath ?? "",
    defaultPath: initial?.defaultPath ?? "",
    color: initial?.color ?? null,
    tmux: initial?.tmux ?? null,
    projectId,
    sudoMode: shownSudoMode(initial?.sudoMode ?? "ask", initial?.auth ?? "password"),
    sudoSecret: "",
  };
}

/** Cambios al elegir otro método de autenticación: se borra lo escrito y «La de la conexión» deja de valer. */
export function pickAuth(f: ServerFormFields, auth: AuthMethod): Partial<ServerFormFields> {
  return auth !== "password" && f.sudoMode === "login" ? { auth, secret: "", sudoMode: "ask" } : { auth, secret: "" };
}

export function validateServerForm(f: ServerFormFields, aliasError: string | null): FormErrors {
  const e: FormErrors = {};
  const h = f.host.trim();
  if (!h) e.host = "Indica el host o la IP";
  else if (/\s/.test(h)) e.host = "El host no puede tener espacios";
  if (!f.username.trim()) e.username = "Indica el usuario";
  const p = Number(f.port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) e.port = "Puerto entre 1 y 65535";
  if (f.auth === "key" && !f.keyPath.trim()) e.keyPath = "Elige la llave privada";
  if (aliasError) e.alias = aliasError;
  return e;
}

/** Solo los errores que impiden probar la conexión (con sus claves aunque estén vacías, para limpiarlas). */
export function connectionErrors(e: FormErrors): FormErrors {
  return { host: e.host, port: e.port, username: e.username, keyPath: e.keyPath };
}

export const hasErrors = (e: FormErrors) => Object.values(e).some(Boolean);

/** Datos de conexión (sin el secreto): si cambian, hay que volver a probar. */
export function connKey(host: string, port: string, username: string, auth: AuthMethod, keyPath: string): string {
  return JSON.stringify([host.trim().toLowerCase(), Number(port) || 22, username.trim(), auth, auth === "key" ? keyPath.trim() : ""]);
}

export function initialConnKey(initial: ServerProfile | null): string {
  return connKey(initial?.host ?? "", String(initial?.port ?? 22), initial?.username ?? "", initial?.auth ?? "password", initial?.keyPath ?? "");
}

export const formConnKey = (f: ServerFormFields) => connKey(f.host, f.port, f.username, f.auth, f.keyPath);

/** Firma de lo que se prueba (incluye el secreto escrito; solo vive en memoria). */
export function testSignature(f: ServerFormFields): string {
  return JSON.stringify([formConnKey(f), f.auth === "agent" ? "" : f.secret]);
}

/** Servidor nuevo, o al editar: cambió el host, puerto, usuario, autenticación o el secreto. */
export function connectionChanged(f: ServerFormFields, isNew: boolean, savedConnKey: string): boolean {
  return isNew || formConnKey(f) !== savedConnKey || (f.auth !== "agent" && f.secret !== "");
}

export function sudoFormState(f: ServerFormFields, isNew: boolean, hasSudoSecret: boolean | null): SudoFormState {
  return {
    mode: f.sudoMode,
    auth: f.auth,
    typed: f.sudoSecret !== "",
    stored: isNew ? false : hasSudoSecret,
    rememberLogin: f.remember,
  };
}

/** Servidor con los datos del formulario (para guardar o probar). */
export function buildServerProfile(id: string, f: ServerFormFields, sudo: SudoFormState): ServerProfile {
  return {
    id,
    name: f.name.trim() || f.host.trim(),
    host: f.host.trim(),
    port: Number(f.port),
    username: f.username.trim(),
    auth: f.auth,
    keyPath: f.auth === "key" ? f.keyPath.trim() : null,
    defaultPath: f.defaultPath.trim() || null,
    color: f.color,
    tmux: f.tmux,
    sudoMode: sudoModeToSave(sudo),
  };
}

/** Lo que ya está guardado del servidor que se edita. */
export interface SavedState {
  isNew: boolean;
  /** Método de autenticación guardado (undefined en uno nuevo). */
  savedAuth: AuthMethod | undefined;
  /** null = desconocido (nuevo o llavero no disponible). */
  hasSecret: boolean | null;
}

/** Secretos para «Probar conexión». */
export function testCredentials(f: ServerFormFields, s: SavedState): TestSecrets {
  const typed = f.auth === "agent" ? "" : f.secret;
  return {
    password: f.auth === "password" && typed ? typed : undefined,
    passphrase: f.auth === "key" && typed ? typed : undefined,
    // Al editar sin escribir el secreto: el ya guardado (si es del mismo método).
    useSavedSecret: !s.isNew && !typed && !!s.hasSecret && s.savedAuth === f.auth,
  };
}

/** Qué hacer con el secreto en el llavero: undefined = no tocar, "" = borrar, texto = guardar. */
export function secretToSave(f: ServerFormFields, s: SavedState): string | undefined {
  const authChanged = !s.isNew && s.savedAuth !== f.auth;
  if (f.auth === "password" || f.auth === "key") {
    if (f.secret !== "" && f.remember) return f.secret;
    if (!f.remember && s.hasSecret) return "";
    if (authChanged && s.hasSecret) return ""; // el secreto antiguo era de otro tipo
    return undefined;
  }
  return authChanged && s.hasSecret ? "" : undefined;
}

/** Contraseña de sudo guardada: solo con «Guardar»; si se cambia a otro modo, se borra. */
export function sudoSecretToSave(mode: SudoMode | undefined, typed: string, hasSudoSecret: boolean | null): string | undefined {
  if (mode === "saved") return typed !== "" ? typed : undefined;
  return hasSudoSecret ? "" : undefined;
}
