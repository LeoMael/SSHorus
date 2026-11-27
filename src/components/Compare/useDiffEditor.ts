// El editor de diferencias de Monaco: se crea una vez con sus dos modelos (izquierda solo lectura,
// derecha editable) y sigue la apariencia, la fuente, el modo (lado a lado / en línea) y «ignorar espacios».
import { useEffect, useRef, useState, type RefObject } from "react";
import { useSettings } from "../../stores/settings";
import { useAppTheme } from "../../stores/appTheme";
import { applyMonacoTheme, monaco } from "../Editor/monacoSetup";

let modelSeq = 0;

interface DiffOpts {
  hostRef: RefObject<HTMLDivElement | null>;
  sideBySide: boolean;
  ignoreSpaces: boolean;
  /** Cambió el contenido de la derecha (para saber si hay cambios sin guardar). */
  onRightChange: () => void;
}

export interface DiffEditorApi {
  editor: RefObject<monaco.editor.IStandaloneDiffEditor | null>;
  left: RefObject<monaco.editor.ITextModel | null>;
  right: RefObject<monaco.editor.ITextModel | null>;
  /** Número de diferencias (bloques cambiados) o null mientras se calcula. */
  changes: number | null;
}

export function useDiffEditor({ hostRef, sideBySide, ignoreSpaces, onRightChange }: DiffOpts): DiffEditorApi {
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const left = useRef<monaco.editor.ITextModel | null>(null);
  const right = useRef<monaco.editor.ITextModel | null>(null);
  const onChangeRef = useRef(onRightChange);
  onChangeRef.current = onRightChange;
  const [changes, setChanges] = useState<number | null>(null);

  const palette = useAppTheme((s) => s.palette);
  const accent = useSettings((s) => s.settings.accent);
  const fontSize = useSettings((s) => s.settings.editorFontSize);
  const fontFamily = useSettings((s) => s.settings.editorFontFamily);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    applyMonacoTheme();
    const n = ++modelSeq;
    const l = monaco.editor.createModel("", "plaintext", monaco.Uri.from({ scheme: "sshorus-diff", authority: `l${n}`, path: "/izquierda" }));
    const r = monaco.editor.createModel("", "plaintext", monaco.Uri.from({ scheme: "sshorus-diff", authority: `r${n}`, path: "/derecha" }));
    const s = useSettings.getState().settings;
    const ed = monaco.editor.createDiffEditor(host, {
      automaticLayout: true,
      fontSize: s.editorFontSize,
      fontFamily: s.editorFontFamily,
      originalEditable: false,
      readOnly: false,
      renderSideBySide: sideBySide,
      // El usuario elige el modo: que no cambie solo cuando la ventana es estrecha.
      useInlineViewWhenSpaceIsLimited: false,
      ignoreTrimWhitespace: ignoreSpaces,
      renderOverviewRuler: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      fixedOverflowWidgets: true,
      padding: { top: 6, bottom: 6 },
    });
    ed.setModel({ original: l, modified: r });
    editor.current = ed;
    left.current = l;
    right.current = r;
    const subs = [
      r.onDidChangeContent(() => onChangeRef.current()),
      ed.onDidUpdateDiff(() => setChanges(ed.getLineChanges()?.length ?? null)),
    ];
    return () => {
      subs.forEach((d) => d.dispose());
      ed.dispose();
      l.dispose();
      r.dispose();
      editor.current = null;
      left.current = null;
      right.current = null;
    };
    // Solo al montar; las opciones que cambian se aplican abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    editor.current?.updateOptions({ renderSideBySide: sideBySide, ignoreTrimWhitespace: ignoreSpaces });
  }, [sideBySide, ignoreSpaces]);

  useEffect(() => {
    applyMonacoTheme();
  }, [palette, accent]);

  useEffect(() => {
    editor.current?.updateOptions({ fontSize, fontFamily });
  }, [fontSize, fontFamily]);

  return { editor, left, right, changes };
}
