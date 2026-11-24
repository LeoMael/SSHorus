// Carga de carpetas y navegación (atrás/adelante/arriba/inicio, ruta escrita, recarga al reconectar).
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { sftp } from "../../api/sftp";
import type { FileEntry } from "../../api/types";
import { basename, dirname, joinPath } from "../../lib/paths";
import { toast } from "../../stores/toasts";
import { sessionOnline } from "./connection";
import { stepHistory, type History, isDirLike } from "../../features/fileExplorer/explorerLogic";
import { useEvent } from "./useEvent";
import type { SelectionState } from "./useSelection";

type HistoryMode = "push" | "back" | "forward" | "none";
export interface LoadOpts {
  history?: HistoryMode;
  /** Ruta a seleccionar al terminar. */
  select?: string | null;
}

interface DirectoryOpts {
  sessionId: string;
  initialPath: string | null;
  reconnectCount: number;
  onPathChange?: (path: string) => void;
  sel: SelectionState;
  setFilter: (v: string) => void;
  listRef: RefObject<HTMLDivElement | null>;
}

export function useDirectory({ sessionId, initialPath, reconnectCount, onPathChange, sel, setFilter, listRef }: DirectoryOpts) {
  const { setSelected, setCursor, anchorRef, scrollToRef } = sel;
  const [cwd, setCwd] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [error, setError] = useState<{ path: string; err: unknown } | null>(null);
  const [hist, setHist] = useState<History>({ back: [], fwd: [] });
  const homeRef = useRef<string | null>(null);
  const reqRef = useRef(0);
  const cwdRef = useRef<string | null>(null);

  const getHome = useCallback(async () => {
    if (!homeRef.current) homeRef.current = await sftp.home(sessionId);
    return homeRef.current;
  }, [sessionId]);

  const load = useEvent(async (path: string, opts: LoadOpts = {}) => {
    // Sin conexión no se pide nada (al reconectar se recarga la carpeta actual).
    if (!sessionOnline(sessionId)) return;
    const req = ++reqRef.current;
    setLoadingPath(path);
    try {
      const list = await sftp.listDir(sessionId, path);
      if (req !== reqRef.current) return;
      const prev = cwdRef.current;
      const same = prev === path;
      const mode = opts.history ?? "push";
      if (prev && !same && mode !== "none") setHist((h) => stepHistory(h, mode, prev));
      cwdRef.current = path;
      setCwd(path);
      setEntries(list);
      setError(null);
      if (opts.select) {
        setSelected(new Set([opts.select]));
        setCursor(opts.select);
        anchorRef.current = opts.select;
        scrollToRef.current = opts.select;
      } else if (same) {
        const exists = new Set(list.map((e) => e.path));
        setSelected((s) => new Set([...s].filter((p) => exists.has(p))));
        setCursor((c) => (c && exists.has(c) ? c : null));
      } else {
        setSelected(new Set());
        setCursor(null);
        anchorRef.current = null;
        setFilter("");
        if (listRef.current) listRef.current.scrollTop = 0;
      }
    } catch (err) {
      if (req !== reqRef.current) return;
      // La conexión se cayó mientras tanto: sin avisos (se recarga al reconectar).
      if (!sessionOnline(sessionId)) return;
      if (cwdRef.current && cwdRef.current !== path) {
        toast.error(`No se pudo abrir «${basename(path)}»`, err);
      } else {
        setError({ path, err });
      }
    } finally {
      if (req === reqRef.current) setLoadingPath(null);
    }
  });

  // Carga inicial (y si cambia la sesión).
  useEffect(() => {
    let cancelled = false;
    homeRef.current = null;
    cwdRef.current = null;
    setCwd(null);
    setEntries([]);
    setHist({ back: [], fwd: [] });
    (async () => {
      let start = initialPath;
      if (!start) {
        try {
          start = await getHome();
        } catch (err) {
          if (!cancelled) setError({ path: "~", err });
          return;
        }
      }
      if (!cancelled) load(start, { history: "none" });
    })();
    return () => {
      cancelled = true;
    };
    // initialPath solo cuenta al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Informa la carpeta actual (la pestaña la usa para reabrirla al reconectar).
  const notifyPath = useEvent((p: string) => onPathChange?.(p));
  useEffect(() => {
    if (cwd) notifyPath(cwd);
  }, [cwd, notifyPath]);

  const refresh = useEvent(() => {
    const target = cwdRef.current ?? error?.path;
    if (!target || target === "~") {
      getHome()
        .then((h) => load(h, { history: "none" }))
        .catch((err) => setError({ path: "~", err }));
      return;
    }
    load(target, { history: "none" });
  });

  // Reconectada (mismo sessionId, canales nuevos): recargar la carpeta actual.
  const seenReconnect = useRef(reconnectCount);
  useEffect(() => {
    if (reconnectCount === seenReconnect.current) return;
    seenReconnect.current = reconnectCount;
    if (!cwdRef.current && !error && initialPath) load(initialPath, { history: "none" });
    else refresh();
    setError(null);
    // Solo cuando sube el contador de reconexiones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnectCount]);

  const navigate = useEvent(async (raw: string) => {
    let p = raw.trim();
    if (!p) return;
    if (p === "~" || p.startsWith("~/")) {
      try {
        p = joinPath(await getHome(), p.slice(2));
      } catch (err) {
        toast.error("No se pudo obtener la carpeta de inicio", err);
        return;
      }
    } else if (!p.startsWith("/")) {
      p = joinPath(cwdRef.current ?? "/", p);
    }
    p = p.length > 1 ? p.replace(/\/+$/, "") : p;
    // Si la ruta escrita es un archivo, se abre su carpeta y se selecciona.
    try {
      const st = await sftp.stat(sessionId, p);
      if (!isDirLike(st)) {
        load(dirname(p), { select: p });
        return;
      }
    } catch {
      /* el listado mostrará el error */
    }
    load(p);
  });

  const goUp = useEvent(() => {
    const c = cwdRef.current;
    if (!c || c === "/") return;
    load(dirname(c), { select: c });
  });
  const goBack = useEvent(() => {
    const t = hist.back[hist.back.length - 1];
    if (t) load(t, { history: "back" });
  });
  const goForward = useEvent(() => {
    const t = hist.fwd[0];
    if (t) load(t, { history: "forward" });
  });
  const goHome = useEvent(async () => {
    try {
      load(await getHome());
    } catch (err) {
      toast.error("No se pudo obtener la carpeta de inicio", err);
    }
  });

  return { cwd, entries, loadingPath, error, hist, cwdRef, load, refresh, navigate, goUp, goBack, goForward, goHome };
}
