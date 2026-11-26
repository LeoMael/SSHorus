// Barra lateral (funciones puras): cuentas guardadas del mismo servidor (mismo host y puerto) agrupadas
// bajo un nodo plegable, con las que administran (sudo o root) primero.
import type { ServerProfile } from "../../api/types";
import { vpsKey } from "../fleet/group";
import type { AccountAdmin } from "../privileges";

/** Marca de administración que se ve en la fila. */
export type SudoBadge = "root" | "sudo";

export interface Account {
  server: ServerProfile;
  sudo: SudoBadge | null;
}

/** Servidor con varias cuentas guardadas. */
export interface MachineNode {
  kind: "machine";
  /** "host:puerto" en minúsculas (como el panel de VPS). */
  key: string;
  /** Lo que se ve: el nombre propio que le puso el usuario o, si no tiene, `host`. */
  label: string;
  /** Nombre automático: el host y, si no es el 22, el puerto. */
  host: string;
  accounts: Account[];
}

export type ServerTreeItem = MachineNode | { kind: "server"; account: Account };

/** Máquina de un servidor guardado: mismo host (sin distinguir mayúsculas) y puerto. Sin host, ninguna. */
export function machineKey(s: Pick<ServerProfile, "id" | "host" | "port">): string {
  return s.host.trim() ? vpsKey(s.host, s.port) : `id:${s.id}`;
}

/** Clave de la fila (y del plegado) de una máquina, dentro de un proyecto o en «Servidores». */
export function machineRowKey(key: string, projectId?: string): string {
  return projectId ? `p:${projectId}:m:${key}` : `m:${key}`;
}

const ADMIN_RANK: Record<AccountAdmin, number> = { user: 1, sudo: 2, root: 3 };

/** La mejor de varias (p. ej. varias pestañas de la misma cuenta): root > sudo > usuario. */
export function bestAdmin(levels: readonly (AccountAdmin | null | undefined)[]): AccountAdmin | null {
  let best: AccountAdmin | null = null;
  for (const l of levels) if (l && (!best || ADMIN_RANK[l] > ADMIN_RANK[best])) best = l;
  return best;
}

/** Lo que dice el perfil por sí solo: usuario root, o una contraseña de sudo configurada. */
function profileAdmin(p: Pick<ServerProfile, "username" | "auth" | "sudoMode">): AccountAdmin | null {
  if (p.username.trim() === "root") return "root";
  if (p.sudoMode === "saved" || (p.sudoMode === "login" && p.auth === "password")) return "sudo";
  return null;
}

/**
 * Marca de sudo de una cuenta. Por orden: lo detectado en una conexión abierta, lo último que se vio
 * (guardado) y lo que dice el perfil. Sin datos, ninguna.
 */
export function resolveSudo(
  live: AccountAdmin | null,
  known: AccountAdmin | null,
  profile: Pick<ServerProfile, "username" | "auth" | "sudoMode">,
): SudoBadge | null {
  const level = live ?? known ?? profileAdmin(profile);
  return level === "root" || level === "sudo" ? level : null;
}

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/** Las que administran primero; luego por nombre (sin distinguir mayúsculas). */
export function compareAccounts(a: Account, b: Account): number {
  return (
    Number(!a.sudo) - Number(!b.sudo) ||
    collator.compare(a.server.name, b.server.name) ||
    collator.compare(a.server.username, b.server.username)
  );
}

/** «host» o «host:puerto». */
function machineLabel(s: ServerProfile): string {
  const host = s.host.trim();
  return s.port && s.port !== 22 ? `${host}:${s.port}` : host;
}

/**
 * Agrupa una lista de servidores por máquina. Una máquina con una sola cuenta queda como fila normal;
 * cada grupo sale donde estaba su primera cuenta (el resto de la lista no cambia de orden).
 * `names`: nombres propios por `machineKey` (ver machineNames.ts).
 */
export function groupByMachine(
  servers: readonly ServerProfile[],
  sudoOf: (s: ServerProfile) => SudoBadge | null,
  names: Readonly<Record<string, string>> = {},
): ServerTreeItem[] {
  const byKey = new Map<string, Account[]>();
  const order: string[] = [];
  for (const s of servers) {
    const key = machineKey(s);
    let accounts = byKey.get(key);
    if (!accounts) {
      accounts = [];
      byKey.set(key, accounts);
      order.push(key);
    }
    accounts.push({ server: s, sudo: sudoOf(s) });
  }
  return order.map((key): ServerTreeItem => {
    const accounts = byKey.get(key) ?? [];
    if (accounts.length === 1) return { kind: "server", account: accounts[0] };
    const host = machineLabel(accounts[0].server);
    return { kind: "machine", key, label: names[key] ?? host, host, accounts: [...accounts].sort(compareAccounts) };
  });
}
