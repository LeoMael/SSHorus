// Atajos dentro de una pestaña de servidor (solo la activa; configurables en Ajustes):
// terminal, división, cerrar el archivo abierto y moverse entre secciones y archivos.
import { useEffect, useLayoutEffect, useRef } from "react";
import { matchesShortcut } from "../../features/shortcuts/shortcuts";
import { closeTarget, currentSection, fileStep, sectionItems, stepItem, type WorkMode, type WorkZone } from "./sessionNav";

export interface SessionKeysOpts<F extends string> {
  active: boolean;
  mode: WorkMode;
  /** Vistas fijas, en el orden de la fila. */
  fixed: readonly F[];
  /** Vista fija elegida y archivo actual. */
  side: F;
  current: string | null;
  /** Archivos abiertos en esta ventana, en el orden de la fila. */
  files: readonly string[];
  toggleTerminal: () => void;
  toggleSplit: () => void;
  /** Muestra una vista fija (en modo pestañas) o la cambia (al dividir). */
  showFixed: (id: F) => void;
  setSide: (id: F) => void;
  showFile: (path: string) => void;
  closeFile: (path: string) => void;
}

function zoneOf(el: EventTarget | null): WorkZone {
  const t = el as HTMLElement | null;
  if (!t?.closest) return "other";
  if (t.closest(".sv-terminal")) return "terminal";
  if (t.closest('[data-sv-panel="side"]')) return "side";
  if (t.closest('[data-sv-panel="editors"]')) return "editors";
  return "other";
}

const IDS = [
  "session.terminal",
  "session.split",
  "session.closeItem",
  "session.nextView",
  "session.prevView",
  "session.nextFile",
  "session.prevFile",
] as const;

export function useSessionKeys<F extends string>(opts: SessionKeysOpts<F>) {
  // Lo último siempre a mano, sin volver a registrar el manejador en cada dibujo.
  const ref = useRef(opts);
  useLayoutEffect(() => {
    ref.current = opts;
  });
  const { active } = opts;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const id = IDS.find((a) => matchesShortcut(a, e));
      if (!id) return;
      const o = ref.current;
      // Con un diálogo abierto solo vale mostrar u ocultar la terminal (como hasta ahora).
      if (id !== "session.terminal" && document.querySelector(".modal-backdrop")) return;
      if (id === "session.split" && o.files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      switch (id) {
        case "session.terminal":
          o.toggleTerminal();
          return;
        case "session.split":
          o.toggleSplit();
          return;
        case "session.closeItem": {
          const path = closeTarget(o.mode, o.current, zoneOf(e.target));
          if (path) o.closeFile(path);
          return;
        }
        case "session.nextView":
        case "session.prevView": {
          const items = sectionItems(o.fixed, o.files, o.mode);
          const next = stepItem(items, currentSection(o.mode, o.side, o.current), id === "session.nextView" ? 1 : -1);
          if (!next) return;
          const fixed = o.fixed.find((f) => f === next);
          if (fixed) (o.mode === "split" ? o.setSide : o.showFixed)(fixed);
          else o.showFile(next);
          return;
        }
        case "session.nextFile":
        case "session.prevFile": {
          const next = fileStep(o.files, o.current, o.mode, id === "session.nextFile" ? 1 : -1);
          if (next) o.showFile(next);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active]);
}
