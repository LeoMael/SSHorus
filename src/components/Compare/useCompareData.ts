// Cargar los dos lados en el editor de diferencias y guardar el de la derecha (con la confirmación del
// editor). También lleva la cuenta de «sin guardar».
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/core";
import { toast } from "../../stores/toasts";
import { blockedMessage, missingMessage, readSide, sideName, type CompareSpec, type SideText } from "../../features/compare";
import { confirmSave } from "../Editor/saveGuard";
import { detectLanguage } from "../Editor/languages";
import { monaco } from "../Editor/monacoSetup";
import type { DiffEditorApi } from "./useDiffEditor";
import { sideIo } from "./sideIo";

export type CompareLoad =
  | { kind: "loading" }
  | { kind: "ready"; notice: string | null }
  | { kind: "blocked"; message: string }
  | { kind: "error"; message: string };

function languageOf(spec: CompareSpec): string {
  const side = spec.right;
  // Rutas locales de Windows con «\»: el lenguaje sale del nombre.
  return detectLanguage(side.kind === "remote" ? side.path : `/${sideName(side)}`);
}

export function useCompareData(spec: CompareSpec, diff: DiffEditorApi, onDirtyChange: (dirty: boolean) => void) {
  const [load, setLoad] = useState<CompareLoad>({ kind: "loading" });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const saved = useRef({ version: 0, modified: null as number | null, missing: false });
  const leftText = useRef<SideText>({ state: "missing" });
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;

  const markDirty = useCallback((d: boolean) => {
    if (dirtyRef.current === d) return;
    dirtyRef.current = d;
    setDirty(d);
    onDirtyRef.current(d);
  }, []);

  /** El contenido de la derecha cambió: ¿difiere de lo guardado? */
  const onRightChange = useCallback(() => {
    const r = diff.right.current;
    if (r) markDirty(r.getAlternativeVersionId() !== saved.current.version);
  }, [diff.right, markDirty]);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const [l, r] = await Promise.all([readSide(spec.left), readSide(spec.right)]);
      const blocked = blockedMessage(l, r);
      if (blocked) {
        setLoad({ kind: "blocked", message: blocked });
        return;
      }
      const lm = diff.left.current;
      const rm = diff.right.current;
      if (!lm || !rm) return;
      const lang = languageOf(spec);
      monaco.editor.setModelLanguage(lm, lang);
      monaco.editor.setModelLanguage(rm, lang);
      leftText.current = l;
      lm.setValue(l.state === "ok" ? l.content : "");
      rm.setValue(r.state === "ok" ? r.content : "");
      saved.current = {
        version: rm.getAlternativeVersionId(),
        modified: r.state === "ok" ? r.modified : null,
        missing: r.state === "missing",
      };
      markDirty(false);
      setLoad({ kind: "ready", notice: missingMessage(l, r) });
    } catch (e) {
      setLoad({ kind: "error", message: errorMessage(e) });
    }
  }, [spec, diff.left, diff.right, markDirty]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (): Promise<boolean> => {
    const rm = diff.right.current;
    if (!rm || savingRef.current || load.kind !== "ready") return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const io = sideIo(spec.right);
      if (!(await confirmSave(io, saved.current.modified, saved.current.missing))) return false;
      const version = rm.getAlternativeVersionId();
      const w = await io.write(rm.getValue());
      saved.current = { version, modified: w.modified, missing: false };
      markDirty(rm.getAlternativeVersionId() !== version);
      // Ya existe a la derecha: el aviso solo puede quedar por la izquierda.
      setLoad({ kind: "ready", notice: missingMessage(leftText.current, { state: "ok", content: "", modified: null }) });
      return true;
    } catch (e) {
      toast.error("No se pudo guardar", e);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [diff.right, load.kind, spec.right, markDirty]);

  return { load, dirty, dirtyRef, saving, reload, save, onRightChange };
}
