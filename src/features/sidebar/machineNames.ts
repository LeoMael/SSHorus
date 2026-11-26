// Barra lateral (funciones puras): nombre propio de una máquina (el grupo de cuentas del mismo host y
// puerto). Se guarda por `machineKey`, así vale igual en «Servidores» y en cada proyecto.
import type { ServerProfile } from "../../api/types";
import { machineKey } from "./machineGroups";

/** Nombre propio por `machineKey`. Sin entrada = el nombre automático (el host). */
export type MachineNames = Readonly<Record<string, string>>;

export const MACHINE_NAME_MAX = 60;

/** Lo guardado (localStorage), sin fiarse: solo textos no vacíos y no demasiado largos. */
export function parseMachineNames(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string") continue;
    const name = v.trim();
    if (name && name.length <= MACHINE_NAME_MAX) out[k] = name;
  }
  return out;
}

/** Error del diálogo «Renombrar máquina» (null = vale; vacío también vale: vuelve al automático). */
export function validateMachineName(v: string): string | null {
  return v.trim().length > MACHINE_NAME_MAX ? `Como mucho ${MACHINE_NAME_MAX} caracteres` : null;
}

/** Pone o quita el nombre. Vacío o igual al automático = se borra (vuelve al automático). */
export function withMachineName(names: MachineNames, key: string, name: string, autoLabel: string): Record<string, string> {
  const next: Record<string, string> = { ...names };
  const v = name.trim();
  if (!v || v === autoLabel) delete next[key];
  else next[key] = v;
  return next;
}

/** La búsqueda de la barra también encuentra las cuentas por el nombre propio de su máquina. */
export function matchesMachineName(s: Pick<ServerProfile, "id" | "host" | "port">, names: MachineNames, q: string): boolean {
  const name = names[machineKey(s)];
  return !!name && name.toLowerCase().includes(q);
}
