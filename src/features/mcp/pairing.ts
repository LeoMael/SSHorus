// Emparejar asistentes de IA: niveles que se ofrecen, permisos de partida y resúmenes. Funciones puras; el
// motor (src-tauri/src/mcp/pairing) guarda los permisos y los aplica.
import type { McpAccess, McpPairedClient, McpVia } from "../../api/mcp";
import { allowsAuto } from "./accessInfo";

/** Niveles que se eligen al emparejar o en «Cambiar permisos». */
export type PairLevel = Extract<McpAccess, "none" | "read" | "full">;

export const PAIR_LEVELS: { value: PairLevel; label: string; title: string }[] = [
  { value: "none", label: "Sin acceso", title: "Este asistente ni ve el servidor." },
  { value: "read", label: "Solo lectura", title: "Listar, leer archivos y comandos de solo lectura." },
  { value: "full", label: "Completo", title: "También cambios, siempre con tu permiso en SSHorus." },
];

export const DEFAULT_LEVEL: PairLevel = "read";

const LABELS: Record<McpAccess, string> = {
  none: "Sin acceso",
  read: "Solo lectura",
  full: "Completo",
  custom: "Solo lo marcado",
};

/** Nivel de un servidor tal como se muestra en el selector («Solo lo marcado» se ve como Completo). */
export function levelOf(access: Record<string, McpAccess>, serverId: string): PairLevel {
  const a = access[serverId] ?? "none";
  return a === "custom" ? "full" : a;
}

/**
 * Permisos de partida. Un asistente que ya existe (al cambiar sus permisos o al volver a emparejarlo) parte
 * de los suyos, aunque sean «Sin acceso» en todos; uno nuevo, de «Solo lectura» en todos.
 */
export function initialAccess(
  serverIds: string[],
  current: Record<string, McpAccess>,
  existing: boolean,
): Record<string, McpAccess> {
  return Object.fromEntries(serverIds.map((id) => [id, existing ? levelOf(current, id) : DEFAULT_LEVEL]));
}

/** Cómo se conectó cada asistente (lista y diálogo). */
export const VIA_LABEL: Record<McpVia, string> = {
  bridge: "Puente",
  oauth: "HTTP (OAuth)",
};

/** Aviso del diálogo según por dónde llega la petición. */
export const VIA_NOTE: Record<McpVia, string> = {
  bridge: "Estos datos los da el propio equipo (el programa que lo pide). Acepta solo si tú le pediste a tu IA que se conectara.",
  oauth:
    "Llega desde tu navegador: acepta solo si acabas de conectar tu asistente a SSHorus. Si la identidad dice «sin comprobar», el nombre lo eligió el propio programa.",
};

/** Lo mismo que entiende el motor: sin los «Sin acceso». */
export function cleanAccess(access: Record<string, McpAccess>): Record<string, McpAccess> {
  return Object.fromEntries(Object.entries(access).filter(([, a]) => a !== "none"));
}

/** «web-prod: Completo · db: Solo lectura», o «Sin acceso a ningún servidor». */
export function accessSummary(access: Record<string, McpAccess>, servers: { id: string; name: string }[]): string {
  const parts = servers.filter((s) => (access[s.id] ?? "none") !== "none").map((s) => `${s.name}: ${LABELS[access[s.id]]}`);
  return parts.length ? parts.join(" · ") : "Sin acceso a ningún servidor";
}

/**
 * «Aceptar automáticamente» se ofrece en un servidor si la conexión con token o algún asistente conectado tiene
 * ahí Completo o Solo lo marcado (luego solo vale para quien tenga ese acceso).
 */
export function autoAllowed(serverId: string, global: McpAccess, paired: McpPairedClient[]): boolean {
  return allowsAuto(global) || paired.some((c) => allowsAuto(c.access[serverId] ?? "none"));
}

/** Asistentes ordenados: el último que se usó primero. */
export function sortClients(list: McpPairedClient[]): McpPairedClient[] {
  return [...list].sort((a, b) => (b.lastUsed ?? b.createdAt) - (a.lastUsed ?? a.createdAt));
}
