// Explorador de archivos remotos (SFTP). DUEÑO: agente SFTP/Explorador.
// Aquí solo se juntan las piezas: carga y navegación (useDirectory), selección (useSelection),
// acciones (useFileActions), arrastres (useDragOut, useUploadEvents), teclado (explorerKeys) y barras.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Upload } from "lucide-react";
import type { FileEntry } from "../../api/types";
import { basename, dirname } from "../../lib/paths";
import { useSettings } from "../../stores/settings";
import { ContextMenu } from "../ui/ContextMenu";
import { FileList } from "./FileList";
import type { SortKey, SortState } from "../../features/fileExplorer/explorerLogic";
import { PermissionsDialog } from "./PermissionsDialog";
import { useTabConnection } from "./connection";
import { visibleRows } from "../../features/fileExplorer/explorerLogic";
import { handleExplorerKey } from "./explorerKeys";
import { explorerMenuItems } from "./explorerMenu";
import { ExplorerActions, ExplorerToolbar } from "./ExplorerToolbar";
import { ExplorerStatus, explorerPlaceholder, ReconnectingPill } from "./ExplorerStatus";
import { useDirectory } from "./useDirectory";
import { useDragOut } from "./useDragOut";
import { useFileActions } from "./useFileActions";
import { useRowHandlers, type MenuAt } from "./useRowHandlers";
import { useSelectionOps, useSelectionState } from "./useSelection";
import { useDropUpload, useUploadRefresh } from "./useUploadEvents";
import { useExplorerNav } from "../../features/fileExplorer/nav";
import "./FileExplorer.css";
import "./FileExplorerList.css";
import "./FileExplorerStatus.css";
import "./FileExplorerDialogs.css";

export interface FileExplorerProps {
  sessionId: string;
  /** Carpeta inicial (null = home del usuario). */
  initialPath: string | null;
  /** Solo la pestaña activa reacciona a arrastrar/soltar y atajos. */
  active: boolean;
  /** Doble clic en un archivo: abrirlo en el editor. */
  onOpenFile: (path: string) => void;
  /** Se llama cada vez que cambia la carpeta actual (p. ej. para reabrirla al reconectar). */
  onPathChange?: (path: string) => void;
}

export const FileExplorer = memo(function FileExplorer({
  sessionId,
  initialPath,
  active,
  onOpenFile,
  onPathChange,
}: FileExplorerProps) {
  const { tabStatus, closedReason, reconnectCount, offline, serverId } = useTabConnection(sessionId);

  const showHidden = useSettings((s) => s.settings.showHiddenFiles);
  const confirmDelete = useSettings((s) => s.settings.confirmDelete);
  const updateSettings = useSettings((s) => s.update);

  const sel = useSelectionState();
  const { selected, setSelected, cursor } = sel;
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "name", dir: 1 });
  const [editingPath, setEditingPath] = useState(false);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [permsFor, setPermsFor] = useState<FileEntry[] | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const typeAheadRef = useRef({ text: "", at: 0 });

  const dir = useDirectory({ sessionId, initialPath, reconnectCount, onPathChange, sel, setFilter, listRef });
  const { cwd, entries, loadingPath, error, hist, cwdRef, load, refresh, goUp, goBack, goForward, goHome } = dir;

  // «Abrir carpeta del proyecto» y similares desde otras vistas de la sesión.
  const navReq = useExplorerNav((s) => s.request);
  useEffect(() => {
    if (!navReq || navReq.sessionId !== sessionId || offline) return;
    useExplorerNav.getState().done(navReq.seq);
    void dir.navigate(navReq.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navReq, sessionId, offline]);

  // Al perder la conexión se cierran menús y diálogos de esta vista.
  useEffect(() => {
    if (!offline) return;
    setMenu(null);
    setPermsFor(null);
    setEditingPath(false);
  }, [offline]);

  // ───────── Filas visibles y selección ─────────

  const rows = useMemo(() => visibleRows(entries, filter, showHidden, sort), [entries, filter, showHidden, sort]);
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.path, i])), [rows]);
  const selectedEntries = useMemo(() => rows.filter((r) => selected.has(r.path)), [rows, selected]);
  const { selectOnly, selectRange, moveCursor } = useSelectionOps(sel, rows, indexOf, listRef);

  const focusRoot = () => {
    if (active) rootRef.current?.focus({ preventScroll: true });
  };

  // ───────── Acciones, arrastres y ratón ─────────

  const actions = useFileActions({ sessionId, cwdRef, load, refresh, onOpenFile, focusRoot, confirmDelete, setPermsFor });
  const { dragPrep, notePress, cancelDragPrep, deferSelectRef } = useDragOut({
    sessionId,
    rows,
    selectedRef: sel.selectedRef,
    selectOnly,
    focusRoot,
  });
  const { handlers, onEmptyMouseDown, onEmptyContextMenu } = useRowHandlers({
    sessionId,
    sel,
    rootRef,
    setMenu,
    selectOnly,
    selectRange,
    openEntry: actions.openEntry,
    notePress,
    deferSelectRef,
  });

  const onSort = useCallback((key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) =>
    handleExplorerKey(e, {
      active,
      offline,
      rootRef,
      listRef,
      filterRef,
      typeAheadRef,
      filter,
      setFilter,
      setEditingPath,
      rows,
      indexOf,
      cursor,
      selected,
      selectedEntries,
      setSelected,
      moveCursor,
      refresh,
      goUp,
      goBack,
      goForward,
      openEntry: actions.openEntry,
      rename: actions.rename,
      remove: actions.remove,
    });

  const drop = useDropUpload({ active, sessionId, rootRef, cwdRef, startUpload: actions.startUpload });
  useUploadRefresh(sessionId, cwdRef, load);

  // ───────── Render ─────────

  const loading = loadingPath !== null;
  const shownPath = cwd ?? (error?.path !== "~" ? error?.path : null) ?? loadingPath ?? "";
  const placeholder = explorerPlaceholder({
    closed: tabStatus === "closed",
    closedReason,
    error,
    cwd,
    rowCount: rows.length,
    entryCount: entries.length,
    filter,
    refresh,
    openParent: (p) => load(dirname(p)),
    goHome,
  });

  let cls = "fx-root";
  if (offline) cls += " fx-offline";
  if (drop.over) cls += " drop-over";
  if (drop.over && !drop.target) cls += " drop-here";
  if (dragPrep) cls += " fx-preparing";

  return (
    <div ref={rootRef} className={cls} tabIndex={0} onKeyDown={onKeyDown} aria-label="Explorador de archivos">
      <ExplorerToolbar
        offline={offline}
        cwd={cwd}
        canBack={hist.back.length > 0}
        canForward={hist.fwd.length > 0}
        loading={loading}
        shownPath={shownPath}
        editingPath={editingPath}
        onEditingChange={(v) => {
          setEditingPath(v);
          if (!v) focusRoot();
        }}
        onNavigate={(p) => {
          if (!offline) dir.navigate(p);
        }}
        goBack={goBack}
        goForward={goForward}
        goUp={goUp}
        refresh={refresh}
        goHome={goHome}
        filter={filter}
        setFilter={setFilter}
        filterRef={filterRef}
      />

      <ExplorerActions
        offline={offline}
        cwd={cwd}
        hasSelection={selectedEntries.length > 0}
        showHidden={showHidden}
        onToggleHidden={() => updateSettings({ showHiddenFiles: !showHidden })}
        onUpload={actions.pickAndUpload}
        onDownload={() => actions.download(selectedEntries)}
        onCreate={actions.createItem}
      />

      <div className="fx-main">
        {loading && <div className="fx-loadbar" />}
        <FileList
          rows={rows}
          selected={selected}
          cursor={cursor}
          dropTarget={drop.target}
          sort={sort}
          onSort={onSort}
          handlers={handlers}
          onEmptyMouseDown={onEmptyMouseDown}
          onEmptyContextMenu={onEmptyContextMenu}
          containerRef={listRef}
          placeholder={placeholder}
        />
        {drop.over && (
          <div className="fx-drop-hint">
            <Upload size={14} />
            Soltar para subir a <strong>{drop.target ? basename(drop.target) : basename(cwd ?? "/")}</strong>
          </div>
        )}
      </div>

      <ExplorerStatus
        shown={rows.length}
        total={entries.length}
        selectedEntries={selectedEntries}
        dragPrep={dragPrep}
        onCancelDragPrep={cancelDragPrep}
      />

      {tabStatus === "reconnecting" && <ReconnectingPill />}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={explorerMenuItems({ onEntry: menu.onEntry, selectedEntries, cwd, serverId, actions, refresh, setPermsFor })}
          onClose={closeMenu}
        />
      )}
      {permsFor && (
        <PermissionsDialog
          entries={permsFor}
          onCancel={() => {
            setPermsFor(null);
            focusRoot();
          }}
          onApply={(mode) => actions.applyPerms(permsFor, mode)}
        />
      )}
    </div>
  );
});
