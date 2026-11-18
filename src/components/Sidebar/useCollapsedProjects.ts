// Proyectos plegados en la barra lateral (se recuerdan entre sesiones en localStorage).
import { useState } from "react";

const COLLAPSED_KEY = "sshorus.sidebar.collapsedProjects";

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeCollapsed(v: Record<string, boolean>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

/** `toggleProject(id)` alterna; con `force` true lo despliega y con false lo pliega. */
export function useCollapsedProjects() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);

  const toggleProject = (id: string, force?: boolean) => {
    setCollapsed((c) => {
      const next = { ...c, [id]: force === undefined ? !c[id] : !force };
      if (!next[id]) delete next[id];
      writeCollapsed(next);
      return next;
    });
  };

  return { collapsed, toggleProject };
}
