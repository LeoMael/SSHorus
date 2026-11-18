// Estado del área de trabajo: archivos abiertos, vista fija elegida, modo (pestañas o dividido)
// y las operaciones que lo cambian (abrir, cerrar, mandar a otra ventana, dividir).
import { useCallback, useMemo, useRef, useState } from "react";
import { basename } from "../../lib/paths";
import { toast } from "../../stores/toasts";
import type { RemoteEditorHandle } from "../Editor/RemoteEditor";
import { getEditorOpenMode } from "../Editor/openPref";
import { focusEditorWindow, openInWindow, useDetachedEditors, type WindowAt } from "../Editor/editorWindows";
import { confirmDialog } from "../ui/dialogs";
import type { FixedTab } from "./fixedViews";
import { useEditorDirty } from "./sessionState";
import { currentFile, neighborAfterClose, workMode } from "./workArea";

const EMPTY: string[] = [];

export function useWorkArea(sessionId: string, connected: boolean) {
  /** Archivos abiertos, en orden de pestañas (incluye los que están en otra ventana). */
  const [files, setFiles] = useState<string[]>([]);
  /** Último archivo elegido. */
  const [activeFile, setActiveFile] = useState<string | null>(null);
  /** Última vista fija elegida (la que se ve en su pestaña o a la izquierda al dividir). */
  const [side, setSide] = useState<FixedTab>("files");
  /** En modo pestañas: ¿se ve la vista fija o el archivo? */
  const [focus, setFocus] = useState<"fixed" | "file">("fixed");
  /** Vista dividida (vista fija | editores), solo si el usuario la pide. */
  const [split, setSplit] = useState(false);
  const editors = useRef(new Map<string, RemoteEditorHandle>());
  const setDirty = useEditorDirty((s) => s.setDirty);

  const detached = useDetachedEditors((s) => s.bySession[sessionId] ?? EMPTY);
  const detachedSet = useMemo(() => new Set(detached), [detached]);
  /** Archivos que se ven como pestaña en esta ventana. */
  const attached = useMemo(() => files.filter((p) => !detachedSet.has(p)), [files, detachedSet]);
  const current = useMemo(
    () => currentFile(activeFile, attached, files, detachedSet),
    [activeFile, attached, files, detachedSet],
  );

  /**
   * Orden fijo en el DOM (el de apertura) para pestañas y editores; el orden visible se da con CSS `order`.
   * Mover el nodo en el DOM al reordenar soltaría el arrastre (pierde la captura del puntero) y movería los editores.
   */
  const seq = useRef(new Map<string, number>());
  for (const p of files) if (!seq.current.has(p)) seq.current.set(p, seq.current.size);
  const stable = useMemo(
    () => [...attached].sort((a, b) => (seq.current.get(a) ?? 0) - (seq.current.get(b) ?? 0)),
    [attached],
  );

  // Sin archivos no hay nada que dividir.
  if (attached.length === 0 && split) setSplit(false);
  const mode = workMode(current, split, focus);

  const showFile = useCallback((path: string) => {
    setActiveFile(path);
    setFocus("file");
  }, []);

  const showFixed = useCallback((id: FixedTab) => {
    setSide(id);
    setFocus("fixed");
  }, []);

  const openFile = useCallback(
    (path: string) => {
      if (detachedSet.has(path)) {
        void focusEditorWindow(sessionId, path);
        return;
      }
      const pref = getEditorOpenMode();
      const isNew = !files.includes(path);
      setFiles((f) => (f.includes(path) ? f : [...f, path]));
      if (pref === "window" && isNew && connected) {
        void openInWindow(sessionId, path);
        return;
      }
      showFile(path);
      if (pref === "split") setSplit(true);
    },
    [detachedSet, files, sessionId, connected, showFile],
  );

  const closeFile = useCallback(
    async (path: string) => {
      if (useEditorDirty.getState().dirty[sessionId]?.includes(path)) {
        const ok = await confirmDialog({
          title: "Cambios sin guardar",
          message: `«${basename(path)}» tiene cambios sin guardar. ¿Cerrarlo y descartarlos?`,
          confirmText: "Descartar",
          danger: true,
        });
        if (!ok) return;
      }
      setDirty(sessionId, path, false);
      const n = neighborAfterClose(attached, path);
      setFiles((f) => f.filter((p) => p !== path));
      // Al cerrar el activo, pasar al de la izquierda (o al primero); sin más archivos, a la vista fija.
      if (current === path) {
        setActiveFile(n);
        if (!n) setFocus("fixed");
      }
    },
    [sessionId, setDirty, attached, current],
  );

  /** Manda el archivo a una ventana aparte. Si tiene cambios sin guardar, primero hay que guardarlos. */
  const detachFile = useCallback(
    async (path: string, at?: WindowAt) => {
      if (!connected) {
        toast.error("No se puede abrir en otra ventana", "No hay conexión con el servidor.");
        return;
      }
      const ed = editors.current.get(path);
      if (ed?.isDirty()) {
        const ok = await confirmDialog({
          title: "Cambios sin guardar",
          message: `«${basename(path)}» tiene cambios sin guardar. Se guardará en el servidor antes de abrirlo en otra ventana.`,
          confirmText: "Guardar y abrir",
        });
        if (!ok || !(await ed.save())) return;
      }
      setDirty(sessionId, path, false);
      await openInWindow(sessionId, path, at);
    },
    [connected, sessionId, setDirty],
  );

  /** Divide el área: la vista fija `id` a la izquierda y el archivo a la derecha. */
  const splitWith = useCallback((id: FixedTab, path?: string) => {
    setSide(id);
    if (path) setActiveFile(path);
    setFocus("file");
    setSplit(true);
  }, []);

  const unsplit = useCallback(() => {
    setSplit(false);
    setFocus("file");
  }, []);

  return {
    files,
    setFiles,
    side,
    setSide,
    split,
    mode,
    current,
    detached,
    attached,
    stable,
    editors,
    setDirty,
    showFile,
    showFixed,
    openFile,
    closeFile,
    detachFile,
    splitWith,
    unsplit,
  };
}
