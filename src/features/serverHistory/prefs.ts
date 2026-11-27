// ¿Se guardan las líneas escritas en la terminal? Apagado por defecto; en todos los servidores (Ajustes →
// Terminal) o solo en algunos (desde su historial). Se guarda en este equipo (localStorage), como la GPU.
import { create } from "zustand";

const KEY = "sshorus.serverHistory.terminal.v1";

export interface TerminalLogPrefs {
  /** En todos los servidores. */
  all: boolean;
  /** Además, en estos (ids de servidor). */
  servers: string[];
}

function read(): TerminalLogPrefs {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const o = v && typeof v === "object" ? (v as Partial<TerminalLogPrefs>) : {};
    return {
      all: o.all === true,
      servers: Array.isArray(o.servers) ? o.servers.filter((s): s is string => typeof s === "string") : [],
    };
  } catch {
    return { all: false, servers: [] };
  }
}

function write(p: TerminalLogPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Sin almacenamiento: queda solo para esta sesión.
  }
}

export const useTerminalLogPrefs = create<TerminalLogPrefs>(() => read());

export function logsTerminal(p: TerminalLogPrefs, serverId: string): boolean {
  return p.all || p.servers.includes(serverId);
}

/** ¿Se guardan ahora las líneas de la terminal de este servidor? */
export function terminalLogOn(serverId: string): boolean {
  return logsTerminal(useTerminalLogPrefs.getState(), serverId);
}

function set(p: TerminalLogPrefs) {
  useTerminalLogPrefs.setState(p);
  write(p);
}

export function setTerminalLogAll(all: boolean): void {
  set({ ...useTerminalLogPrefs.getState(), all });
}

export function setTerminalLogServer(serverId: string, on: boolean): void {
  const p = useTerminalLogPrefs.getState();
  const servers = p.servers.filter((s) => s !== serverId);
  set({ ...p, servers: on ? [...servers, serverId] : servers });
}
