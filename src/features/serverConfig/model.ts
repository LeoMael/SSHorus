// Tipos del panel «Configuración» (Administración): cada sección dice cómo está el servidor en una frase,
// el detalle, las comprobaciones de la Auditoría que le tocan y los cambios que se pueden hacer.
import type { Check } from "../../api/audit";

/** «na» = no aplica en este servidor (no existe o no está instalado y no tiene sentido). */
export type ConfigStatus = "ok" | "warn" | "bad" | "info" | "na" | "skip";

export type SectionId = "mac" | "ssh" | "updates" | "fail2ban" | "sysctl" | "sudo" | "hidepid" | "firewall";

/** Un cambio listo para enseñar (comando exacto) y ejecutar como root. */
export interface ConfigChange {
  id: string;
  /** Texto del botón. */
  label: string;
  /** Título del diálogo, de la tarea y del historial. */
  title: string;
  /** Qué hace, en palabras simples. */
  explain: string;
  /** Pasos de shell ya citados (se ejecutan con `sh -e` como root). */
  steps: string[];
  /** Puede cortar el acceso o un servicio: hay que escribir una palabra para confirmar. */
  danger: boolean;
  note: string | null;
  /** Necesita la comprobación previa de la Auditoría (que no te quedes fuera): la comprobación de origen. */
  guardCheck: Check | null;
  timeoutSecs: number;
}

/** Un dato de la sección («Modo actual: Enforcing»). */
export interface Fact {
  label: string;
  value: string;
  status?: ConfigStatus;
}

/** Una fila de una lista (una denegación, un boolean, una cárcel de fail2ban, un valor de sysctl…). */
export interface ConfigRow {
  id: string;
  title: string;
  detail: string;
  status: ConfigStatus;
  /** Cambio con botón propio. */
  change: ConfigChange | null;
  /** Qué hacer si no hay arreglo seguro. */
  advice: string | null;
  /** Comando para copiar o pegar en la terminal (no se ejecuta solo). */
  copy: string | null;
}

export interface RowGroup {
  title: string;
  /** Qué decir si no hay filas. */
  empty: string;
  rows: ConfigRow[];
}

export interface ConfigSection {
  id: SectionId;
  title: string;
  status: ConfigStatus;
  /** El estado en una frase. */
  summary: string;
  facts: Fact[];
  groups: RowGroup[];
  /** Comprobaciones de la Auditoría que tocan a esta sección (con su «Arreglar»). */
  checks: Check[];
  changes: ConfigChange[];
  /** Avisos y lo que no se pudo leer. */
  notes: string[];
  /** Enlace a otra parte de Administración. */
  link: "firewall" | "users" | null;
}

export interface ServerConfig {
  sections: ConfigSection[];
  /** Se leyó como root. */
  elevated: boolean;
  os: string;
}

export function change(c: Omit<ConfigChange, "danger" | "note" | "guardCheck" | "timeoutSecs"> & Partial<ConfigChange>): ConfigChange {
  return { danger: false, note: null, guardCheck: null, timeoutSecs: 120, ...c };
}

export function row(r: Omit<ConfigRow, "change" | "advice" | "copy"> & Partial<ConfigRow>): ConfigRow {
  return { change: null, advice: null, copy: null, ...r };
}

export function section(s: Omit<ConfigSection, "facts" | "groups" | "checks" | "changes" | "notes" | "link"> & Partial<ConfigSection>): ConfigSection {
  return { facts: [], groups: [], checks: [], changes: [], notes: [], link: null, ...s };
}

/** Peor estado de varios (para el resumen de una sección). */
const RANK: Record<ConfigStatus, number> = { bad: 5, warn: 4, skip: 3, info: 2, ok: 1, na: 0 };
export function worst(...ss: ConfigStatus[]): ConfigStatus {
  return ss.reduce<ConfigStatus>((a, b) => (RANK[b] > RANK[a] ? b : a), "na");
}

/** Un cambio a partir del arreglo de una comprobación de la Auditoría (mismo comando, misma comprobación previa). */
export function changeFromCheck(c: Check, guarded: boolean): ConfigChange | null {
  if (!c.fix || c.fix.manual) return null;
  return change({
    id: `audit:${c.id}`,
    label: "Arreglar",
    title: c.title,
    explain: c.detail,
    steps: c.fix.command.split("\n"),
    danger: c.fix.danger,
    note: c.fix.note,
    guardCheck: guarded ? c : null,
    timeoutSecs: 900,
  });
}
