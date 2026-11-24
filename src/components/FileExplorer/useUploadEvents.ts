// Subidas que llegan de fuera: soltar archivos del sistema sobre la lista y refrescar al terminar.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { EV_TRANSFER_UPDATE, type TransferJob } from "../../api/types";
import { sessionOnline } from "./connection";
import { isOwnDragPaths, ownDragActive } from "./dragOut";
import type { LoadOpts } from "./useDirectory";

interface DropOpts {
  active: boolean;
  sessionId: string;
  rootRef: RefObject<HTMLDivElement | null>;
  cwdRef: RefObject<string | null>;
  startUpload: (paths: string[], dir: string | null) => void;
}

/** Arrastrar y soltar desde el sistema: `over` mientras pasa por encima y la carpeta bajo el cursor. */
export function useDropUpload({ active, sessionId, rootRef, cwdRef, startUpload }: DropOpts) {
  const [drop, setDrop] = useState<{ over: boolean; target: string | null }>({ over: false, target: null });
  const dropRef = useRef(drop);
  const ownOverRef = useRef(false);
  const setDropState = useCallback((over: boolean, target: string | null) => {
    const d = dropRef.current;
    if (d.over === over && d.target === target) return;
    dropRef.current = { over, target };
    setDrop(dropRef.current);
  }, []);

  useEffect(() => {
    if (!active) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    try {
      getCurrentWebview()
        .onDragDropEvent((ev) => {
          const p = ev.payload;
          // Arrastre que salió de SSHorus (archivos de la caché de arrastre) pasando por la
          // ventana: no es para subir. Las rutas solo llegan en "enter" y "drop".
          if (p.type === "enter") ownOverRef.current = isOwnDragPaths(p.paths);
          const own = ownOverRef.current || ownDragActive() || (p.type === "drop" && isOwnDragPaths(p.paths));
          if (p.type === "leave" || p.type === "drop") ownOverRef.current = false;
          if (own || p.type === "leave") {
            setDropState(false, null);
            return;
          }
          const root = rootRef.current;
          if (!root || root.offsetParent === null) return;
          const dpr = window.devicePixelRatio || 1;
          const x = p.position.x / dpr;
          const y = p.position.y / dpr;
          const r = root.getBoundingClientRect();
          const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
          let target: string | null = null;
          if (inside) {
            const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-fx-dir]");
            if (el && root.contains(el)) target = el.dataset.fxPath ?? null;
          }
          if (!sessionOnline(sessionId)) {
            setDropState(false, null);
            return;
          }
          if (p.type === "drop") {
            setDropState(false, null);
            if (inside) startUpload(p.paths, target ?? cwdRef.current);
            return;
          }
          setDropState(inside, target);
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    } catch {
      /* fuera de Tauri */
    }
    return () => {
      disposed = true;
      unlisten?.();
      setDropState(false, null);
    };
  }, [active, cwdRef, rootRef, sessionId, setDropState, startUpload]);

  return drop;
}

/** Al terminar una subida a la carpeta actual (o debajo), se recarga el listado. */
export function useUploadRefresh(sessionId: string, cwdRef: RefObject<string | null>, load: (path: string, opts?: LoadOpts) => void) {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    listen<TransferJob[]>(EV_TRANSFER_UPDATE, (ev) => {
      const dir = cwdRef.current;
      if (!dir || !sessionOnline(sessionId)) return;
      const prefix = dir === "/" ? "/" : `${dir}/`;
      const hit = ev.payload.some(
        (j) => j.sessionId === sessionId && j.direction === "upload" && j.status === "done" && j.remotePath.startsWith(prefix),
      );
      if (!hit) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (cwdRef.current === dir) load(dir, { history: "none" });
      }, 600);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      clearTimeout(timer);
      unlisten?.();
    };
  }, [cwdRef, sessionId, load]);
}
