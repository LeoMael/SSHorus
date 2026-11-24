// `run_with_password` del asistente: el motor pide al usuario qué contraseña escribir en un programa que la
// pregunta (peticiones `password-run`, antes de ejecutar, y `password-prompt`, si el programa hace otra
// pregunta). Funciones puras (probadas en passwordAsk.test.ts): leer la petición, las opciones, la elegida
// por defecto y la respuesta al motor. La cola de diálogos está en passwordRun.ts.
// La contraseña guardada no pasa por aquí: el motor la lee él mismo si el usuario elige «guardada».

export interface PasswordAsk {
  id: string;
  /** "run": permiso para ejecutar y primera contraseña. "prompt": otra pregunta del mismo programa. */
  kind: "run" | "prompt";
  serverName: string;
  user: string;
  command: string;
  reason: string;
  promptHint: string | null;
  danger: string[];
  client: string | null;
  /** Pregunta del programa ("prompt"). */
  prompt: string;
  /** Preguntas ya respondidas ("prompt"). */
  previous: string[];
  hasLogin: boolean;
  hasSudo: boolean;
  /** Unix ms: después el motor deja de esperar. */
  expiresAt: number;
}

export type PasswordSource = "login" | "sudo" | "typed" | "reuse";

export interface PasswordChoice {
  source: PasswordSource;
  typed: string;
  /** Índice de `previous` con «reuse». */
  reuse: number;
  /** Solo en "run": usar la misma en todas las preguntas del programa. */
  sameForAll: boolean;
}

export type PasswordReply =
  | { canceled: true }
  | { source: "login" | "sudo"; sameForAll: boolean }
  | { password: string; sameForAll: boolean }
  | { reuse: number };

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Petición del motor → datos del diálogo. */
export function parseAsk(id: string, kind: "run" | "prompt", p: Record<string, unknown>, now = Date.now()): PasswordAsk {
  const secs = typeof p.timeoutSecs === "number" && p.timeoutSecs > 0 ? p.timeoutSecs : 120;
  return {
    id,
    kind,
    serverName: str(p.serverName) || "el servidor",
    user: str(p.user),
    command: str(p.command),
    reason: str(p.reason),
    promptHint: str(p.promptHint) || null,
    danger: Array.isArray(p.danger) ? p.danger.filter((d): d is string => typeof d === "string") : [],
    client: str(p.client) || null,
    prompt: str(p.prompt),
    previous: Array.isArray(p.previous) ? p.previous.filter((d): d is string => typeof d === "string") : [],
    hasLogin: p.hasLogin === true,
    hasSudo: p.hasSudo === true,
    expiresAt: now + secs * 1000,
  };
}

/** Opciones del diálogo, en orden. */
export function passwordOptions(a: PasswordAsk): { source: PasswordSource; reuse?: number; label: string }[] {
  const opts: { source: PasswordSource; reuse?: number; label: string }[] = [];
  a.previous.forEach((p, i) => opts.push({ source: "reuse", reuse: i, label: `La misma que en «${p}»` }));
  if (a.hasLogin) opts.push({ source: "login", label: "Usar la contraseña guardada de la conexión" });
  if (a.hasSudo) opts.push({ source: "sudo", label: "Usar la contraseña de sudo guardada" });
  opts.push({ source: "typed", label: "Escribir otra" });
  return opts;
}

/** Lo elegido al abrir: la guardada si hay (en otra pregunta, la misma que la anterior); si no, escribirla. */
export function initialChoice(a: PasswordAsk): PasswordChoice {
  const base = { typed: "", reuse: 0, sameForAll: true };
  if (a.kind === "prompt" && a.previous.length > 0) return { ...base, source: "reuse", reuse: a.previous.length - 1 };
  if (a.hasLogin) return { ...base, source: "login" };
  if (a.hasSudo) return { ...base, source: "sudo" };
  return { ...base, source: "typed" };
}

/** Respuesta al motor. null = aún no se puede enviar (contraseña vacía o con saltos de línea). */
export function buildReply(a: PasswordAsk, c: PasswordChoice): PasswordReply | null {
  const sameForAll = a.kind === "run" && c.sameForAll;
  switch (c.source) {
    case "login":
      return a.hasLogin ? { source: "login", sameForAll } : null;
    case "sudo":
      return a.hasSudo ? { source: "sudo", sameForAll } : null;
    case "reuse":
      return c.reuse >= 0 && c.reuse < a.previous.length ? { reuse: c.reuse } : null;
    case "typed":
      return c.typed && !/[\r\n]/.test(c.typed) ? { password: c.typed, sameForAll } : null;
  }
}
