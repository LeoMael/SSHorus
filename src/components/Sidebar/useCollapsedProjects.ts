// Preferencias de la barra lateral que se recuerdan entre sesiones en localStorage: proyectos y servidores
// (con varias cuentas) plegados, y el nombre propio de cada máquina.
import { useState } from "react";
import { parseMachineNames, withMachineName } from "../../features/sidebar/machineNames";

const PROJECTS_KEY = "sshorus.sidebar.collapsedProjects";
const MACHINES_KEY = "sshorus.sidebar.collapsedMachines";
const MACHINE_NAMES_KEY = "sshorus.sidebar.machineNames";

function readStored(storageKey: string): unknown {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function readCollapsed(storageKey: string): Record<string, boolean> {
  const v = readStored(storageKey);
  return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
}

function writeStored(storageKey: string, v: object) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

/** `toggle(id)` alterna; con `force` true lo despliega y con false lo pliega. */
function useCollapsed(storageKey: string) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => readCollapsed(storageKey));

  const toggle = (id: string, force?: boolean) => {
    setCollapsed((c) => {
      if (force === true && !c[id]) return c;
      const next = { ...c, [id]: force === undefined ? !c[id] : !force };
      if (!next[id]) delete next[id];
      writeStored(storageKey, next);
      return next;
    });
  };

  return { collapsed, toggle };
}

export function useCollapsedProjects() {
  const { collapsed, toggle } = useCollapsed(PROJECTS_KEY);
  return { collapsed, toggleProject: toggle };
}

/** Claves: `machineRowKey` (la misma máquina se pliega aparte en cada proyecto y en «Servidores»). */
export function useCollapsedMachines() {
  return useCollapsed(MACHINES_KEY);
}

export type CollapsedMachines = ReturnType<typeof useCollapsedMachines>;

/** Nombre propio de cada máquina (por `machineKey`, el mismo en «Servidores» y en los proyectos). */
export function useMachineNames() {
  const [names, setNames] = useState<Record<string, string>>(() => parseMachineNames(readStored(MACHINE_NAMES_KEY)));

  /** Vacío = vuelve al nombre automático (`autoLabel`). */
  const rename = (key: string, name: string, autoLabel: string) => {
    setNames((n) => {
      const next = withMachineName(n, key, name, autoLabel);
      writeStored(MACHINE_NAMES_KEY, next);
      return next;
    });
  };

  return { names, rename };
}

export type MachineNamesState = ReturnType<typeof useMachineNames>;
