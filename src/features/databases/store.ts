// Lo último que se encontró en cada conexión (lo reutiliza el MCP para no volver a buscar) y los archivos
// SQLite que el usuario añadió a cada servidor. Sin contraseñas: las formas de entrar que funcionaron
// viven en la pestaña (se olvidan al cerrarla).
import { create } from "zustand";
import type { Discovery } from "./remote";

interface DbStore {
  discovery: Record<string, Discovery>;
  setDiscovery: (sessionId: string, d: Discovery) => void;
}

export const useDbDiscovery = create<DbStore>((set) => ({
  discovery: {},
  setDiscovery: (sessionId, d) => set((s) => ({ discovery: { ...s.discovery, [sessionId]: d } })),
}));

const KEY = "sshorus.databases.sqlite";
const MAX_FILES = 20;

function readAll(): Record<string, string[]> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

/** Rutas de SQLite añadidas a este servidor. */
export function loadSqlitePaths(profileId: string): string[] {
  const v = readAll()[profileId];
  return Array.isArray(v) ? v.filter((p) => typeof p === "string" && p.startsWith("/")) : [];
}

export function saveSqlitePaths(profileId: string, paths: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [profileId]: paths.slice(0, MAX_FILES) }));
  } catch {
    // sin almacenamiento: se olvidan al cerrar
  }
}
