// Escape en un diálogo abierto ENCIMA de otro (Ajustes, editor de servidor): cierra solo el de arriba.
import { useEffect, useRef } from "react";

/**
 * Cada `Modal` escucha Escape en `window`; con dos abiertos se cerrarían los dos. Este oyente va en
 * fase de captura (antes que ellos) y corta el evento. Si encima hay un aviso de conexión
 * (contraseña, huella…), lo deja pasar para que se cierre ese aviso.
 */
export function useTopEscape(onEscape: () => void) {
  const cb = useRef(onEscape);
  cb.current = onEscape;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".cd-prompt")) return;
      e.stopPropagation();
      cb.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
