// Pestaña «Comparar archivos»: dos archivos lado a lado (o en línea) con lo añadido en verde y lo quitado
// en rojo. La izquierda es de solo lectura; la derecha se puede editar y guardar (Ctrl+S).
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowLeftRight, ArrowUp, FileWarning, Info, RotateCw, Save } from "lucide-react";
import { useTabs } from "../../stores/tabs";
import { confirmDialog } from "../ui/dialogs";
import { Segmented } from "../ui/Segmented";
import { sideLabel, swapSides, useCompare, type CompareSide, type CompareSpec } from "../../features/compare";
import { matchesShortcut, useShortcutText, withShortcut } from "../../features/shortcuts/shortcuts";
import { useDiffEditor } from "./useDiffEditor";
import { useCompareData } from "./useCompareData";
import "./Compare.css";

interface Props {
  compareKey: string;
  active: boolean;
  onDirtyChange: (dirty: boolean) => void;
}

/** El lado tiene con qué guardarse: su conexión sigue abierta (o es un archivo de este equipo). */
function useSideOnline(side: CompareSide): boolean {
  return useTabs((s) => side.kind === "local" || s.tabs.some((t) => t.sessionId === side.sessionId && t.status === "connected"));
}

export function CompareView({ compareKey, active, onDirtyChange }: Props) {
  const spec = useCompare((s) => s.specs[compareKey]);
  // Al cerrar la pestaña se olvida lo que comparaba.
  useEffect(() => () => useCompare.getState().forget(compareKey), [compareKey]);
  if (!spec) return <div className="empty-state">Esta comparación ya no está disponible.</div>;
  return <CompareBody compareKey={compareKey} spec={spec} active={active} onDirtyChange={onDirtyChange} />;
}

function CompareBody({ compareKey, spec, active, onDirtyChange }: Props & { spec: CompareSpec }) {
  const [sideBySide, setSideBySide] = useState(true);
  const [ignoreSpaces, setIgnoreSpaces] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const changeRef = useRef(() => {});
  const diff = useDiffEditor({ hostRef, sideBySide, ignoreSpaces, onRightChange: () => changeRef.current() });
  const data = useCompareData(spec, diff, onDirtyChange);
  changeRef.current = data.onRightChange;
  const { load, dirty, saving } = data;
  const leftOnline = useSideOnline(spec.left);
  const rightOnline = useSideOnline(spec.right);
  const saveKeys = useShortcutText("editor.save");
  const saveRef = useRef(data.save);
  saveRef.current = data.save;

  // Guardar (atajo del editor) y F7 / Mayús+F7 para ir de una diferencia a otra, solo si se ve.
  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(() => {
      diff.editor.current?.layout();
      diff.editor.current?.getModifiedEditor().focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.(".xterm")) return;
      if (matchesShortcut("editor.save", e)) {
        e.preventDefault();
        e.stopPropagation();
        void saveRef.current();
      } else if (e.key === "F7" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        diff.editor.current?.goToDiff(e.shiftKey ? "previous" : "next");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [active, diff.editor]);

  const ask = (title: string) =>
    !data.dirtyRef.current ||
    confirmDialog({ title, message: "Tienes cambios sin guardar a la derecha. ¿Seguir y perderlos?", confirmText: "Seguir", danger: true });

  const swap = async () => {
    if (await ask("Intercambiar lados")) useCompare.getState().update(compareKey, swapSides(spec));
  };
  const reload = async () => {
    if (await ask("Volver a leer")) void data.reload();
  };

  const ready = load.kind === "ready";
  const canSave = ready && !saving && rightOnline;
  const go = (t: "next" | "previous") => diff.editor.current?.goToDiff(t);

  return (
    <div className="cmp-root">
      <div className="cmp-head">
        <SideTitle side={spec.left} hint="Solo lectura" online={leftOnline} />
        <button className="icon-btn cmp-btn" onClick={() => void swap()} title="Intercambiar lados (la derecha es la que se edita)" aria-label="Intercambiar lados">
          <ArrowLeftRight size={14} />
        </button>
        <SideTitle side={spec.right} hint={dirty ? "Sin guardar" : "Se puede editar"} online={rightOnline} dirty={dirty} />
      </div>
      {ready && load.notice && (
        <div className="cmp-notice" role="status">
          <Info size={14} /> {load.notice}
        </div>
      )}
      <div className="cmp-body">
        <div ref={hostRef} className="cmp-host" style={{ visibility: ready ? "visible" : "hidden" }} />
        {load.kind === "loading" && (
          <div className="cmp-overlay">
            <div className="spinner" />
            <span>Leyendo los dos archivos…</span>
          </div>
        )}
        {(load.kind === "blocked" || load.kind === "error") && (
          <div className="cmp-overlay">
            <div className="cmp-error">
              {load.kind === "blocked" ? <FileWarning size={26} /> : <AlertTriangle size={26} />}
              <strong>{load.kind === "blocked" ? "No se puede comparar" : "No se pudo leer"}</strong>
              <p>{load.message}</p>
              <button className="btn btn-sm" onClick={() => void data.reload()}>
                <RotateCw size={14} /> Reintentar
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="cmp-bar">
        <span className="cmp-count">
          {ready && diff.changes !== null ? (diff.changes === 0 ? "Sin diferencias" : diff.changes === 1 ? "1 diferencia" : `${diff.changes} diferencias`) : ""}
        </span>
        <Segmented
          label="Vista"
          value={sideBySide ? "side" : "inline"}
          options={[
            { value: "side", label: "Lado a lado" },
            { value: "inline", label: "En línea" },
          ]}
          onChange={(v) => setSideBySide(v === "side")}
        />
        <label className="cmp-check" title="No marcar como diferencia los espacios al principio y al final de las líneas">
          <input type="checkbox" checked={ignoreSpaces} onChange={(e) => setIgnoreSpaces(e.target.checked)} />
          Ignorar espacios
        </label>
        <span className="cmp-fill" />
        <button className="icon-btn cmp-btn" onClick={() => go("previous")} disabled={!ready} title="Diferencia anterior (Mayús+F7)" aria-label="Diferencia anterior">
          <ArrowUp size={14} />
        </button>
        <button className="icon-btn cmp-btn" onClick={() => go("next")} disabled={!ready} title="Diferencia siguiente (F7)" aria-label="Diferencia siguiente">
          <ArrowDown size={14} />
        </button>
        <button className="icon-btn cmp-btn" onClick={() => void reload()} disabled={saving} title="Volver a leer los dos archivos" aria-label="Volver a leer">
          <RotateCw size={14} />
        </button>
        <button
          className="icon-btn cmp-btn"
          onClick={() => void data.save()}
          disabled={!canSave}
          title={rightOnline ? withShortcut("Guardar la derecha", saveKeys) : "Sin conexión con ese servidor: no se puede guardar"}
          aria-label="Guardar la derecha"
        >
          <Save size={14} />
        </button>
      </div>
    </div>
  );
}

function SideTitle({ side, hint, online, dirty = false }: { side: CompareSide; hint: string; online: boolean; dirty?: boolean }) {
  const label = sideLabel(side);
  return (
    <div className="cmp-side" title={label}>
      <span className="cmp-side-label mono">{`‎${label}‎`}</span>
      <span className={dirty ? "cmp-tag cmp-dirty" : "cmp-tag"}>{online ? hint : "Sin conexión"}</span>
    </div>
  );
}

export default CompareView;
