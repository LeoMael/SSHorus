// Proyectos y servidores (con varias cuentas) plegados en la barra lateral: se recuerdan entre sesiones
// en localStorage.
import { useState } from "react";

const PROJECTS_KEY = "sshorus.sidebar.collapsedProjects";
const MACHINES_KEY = "sshorus.sidebar.collapsedMachines";

function readCollapsed(storageKey: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(storageKey);
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeCollapsed(storageKey: string, v: Record<string, boolean>) {
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
      writeCollapsed(storageKey, next);
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
