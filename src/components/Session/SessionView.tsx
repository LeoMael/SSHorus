// Contenido de una pestaña de conexión: área de trabajo arriba y terminales abajo.
// El área de trabajo funciona como las pestañas de un navegador: una sola fila con las vistas fijas
// (Archivos, Comandos, Administración) y los archivos abiertos; se ve solo la elegida, a todo el área.
// Bajo pedido se divide en dos (vista fija | editores), y la pestaña de un archivo se puede arrastrar para
// reordenarla o, soltándola fuera de la ventana, abrirla en una ventana aparte.
// Piezas: estado (useWorkArea), paneles (useSessionLayout), arrastre (useTabDrag), pestañas (WorkTabs)
// y contenido (WorkPanes).
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Columns2, ExternalLink, PanelBottomClose, PanelBottomOpen } from "lucide-react";
import type { SessionTab } from "../../stores/tabs";
import { ContextMenu } from "../FileExplorer/ContextMenu";
import { TerminalArea } from "../Terminal/TerminalArea";
import { initEditorWindowsBridge } from "../Editor/editorWindows";
import { setSessionPath, useEditorDirty } from "./sessionState";
import { useSessionKeys } from "./useSessionKeys";
import { FIXED_IDS, fixedLabel } from "./fixedViews";
import { ClosedBanner, ReconnectingBanner } from "./SessionBanners";
import { DetachedButton } from "./DetachedButton";
import { fileTabMenuItems } from "./fileTabMenu";
import { useNavRequests } from "./useNavRequests";
import { useSessionLayout } from "./useSessionLayout";
import { useTabDrag } from "./useTabDrag";
import { useWorkArea } from "./useWorkArea";
import { EditorPanes, SidePanes, useMountedViews } from "./WorkPanes";
import { FileTabs, FixedTabs, TabDragGhost } from "./WorkTabs";
import "./SessionView.css";
import { useShortcutText, withShortcut } from "../../features/shortcuts/shortcuts";

export { CommandsPanel } from "./WorkPanes";

export interface SessionViewProps {
  tab: SessionTab;
  active: boolean;
}

const EMPTY: string[] = [];

export const SessionView = memo(function SessionView({ tab, active }: SessionViewProps) {
  const sessionId = tab.sessionId;
  const closed = tab.status === "closed";
  const connected = tab.status === "connected";
  const w = useWorkArea(sessionId, connected);
  const { side, split, mode, current, attached, stable, showFile, showFixed, closeFile, detachFile, splitWith, unsplit } = w;
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  const sideVisible = mode !== "editors";
  const editorsVisible = mode !== "side";
  /** Pestaña elegida en la fila única (modo pestañas). */
  const selected: string = mode === "editors" && current ? current : side;

  const mounted = useMountedViews(side);
  const lay = useSessionLayout();
  const dirtyPaths = useEditorDirty((s) => s.dirty[sessionId] ?? EMPTY);
  const onPathChange = useCallback((path: string) => setSessionPath(sessionId, path), [sessionId]);

  useEffect(() => initEditorWindowsBridge(), []);
  useNavRequests({ sessionId, showFixed, showFile, setFiles: w.setFiles });

  // Atajos dentro del servidor (terminal, división, Ctrl+W, secciones y archivos): ver useSessionKeys.
  useSessionKeys({
    active,
    mode,
    fixed: FIXED_IDS,
    side,
    current,
    files: attached,
    toggleTerminal: lay.toggleTerminal,
    toggleSplit: () => (split ? unsplit() : splitWith(side)),
    showFixed,
    setSide: w.setSide,
    showFile,
    closeFile: (p) => void closeFile(p),
  });

  const drag = useTabDrag({ files: w.files, setFiles: w.setFiles, showFile, connected, detachFile });

  const dirtySet = useMemo(() => new Set(dirtyPaths), [dirtyPaths]);
  const closeTabMenu = useCallback(() => setTabMenu(null), []);

  const termKeys = useShortcutText("session.terminal");
  const splitKeys = useShortcutText("session.split");
  const paletteKeys = useShortcutText("app.palette");
  const termToggle = (
    <button
      className={lay.termCollapsed ? "icon-btn sv-bar-btn" : "icon-btn sv-bar-btn on"}
      onClick={lay.toggleTerminal}
      title={withShortcut(lay.termCollapsed ? "Mostrar terminal" : "Ocultar terminal", termKeys)}
      aria-label="Mostrar u ocultar terminal"
    >
      {lay.termCollapsed ? <PanelBottomOpen size={15} /> : <PanelBottomClose size={15} />}
    </button>
  );
  const detachedButton = <DetachedButton sessionId={sessionId} paths={w.detached} />;

  /** Pestañas de los archivos (arrastrables). */
  const fileTabs = (isOn: (p: string) => boolean) => (
    <FileTabs
      stable={stable}
      attached={attached}
      isOn={isOn}
      dirtySet={dirtySet}
      drag={drag}
      showFile={showFile}
      closeFile={(p) => void closeFile(p)}
      openMenu={(x, y, path) => setTabMenu({ x, y, path })}
    />
  );

  const windowButton = (
    <button
      className="icon-btn sv-bar-btn"
      onClick={() => current && void detachFile(current)}
      disabled={!current || !connected}
      title="Abrir en ventana aparte (o arrastra la pestaña fuera de la ventana)"
      aria-label="Abrir en ventana aparte"
    >
      <ExternalLink size={15} />
    </button>
  );

  return (
    <div className={active ? "sv-root" : "sv-root sv-hidden"} aria-hidden={!active}>
      {tab.status === "reconnecting" && <ReconnectingBanner tab={tab} visible={active} />}
      {closed && <ClosedBanner tab={tab} />}
      <Group orientation="vertical" className="sv-group" defaultLayout={lay.defaultLayout} onLayoutChanged={lay.onLayoutChanged}>
        <Panel id="work" minSize="120px" className="sv-work" style={{ overflow: "hidden" }}>
          {mode !== "split" && (
            // Modo pestañas: una sola fila con las vistas fijas y los archivos.
            <div className="sv-tabs" role="tablist" aria-label="Área de trabajo">
              <FixedTabs isOn={(id) => selected === id} onPick={showFixed} paletteKeys={paletteKeys} />
              {attached.length > 0 && <span className="sv-tabs-sep" aria-hidden />}
              {fileTabs((p) => selected === p)}
              <div className="sv-tabs-fill" />
              {detachedButton}
              {mode === "editors" && (
                <>
                  {windowButton}
                  <button
                    className="icon-btn sv-bar-btn"
                    onClick={() => splitWith(side)}
                    title={withShortcut(`Dividir con ${fixedLabel(side)}`, splitKeys)}
                    aria-label={`Dividir con ${fixedLabel(side)}`}
                  >
                    <Columns2 size={15} />
                  </button>
                </>
              )}
              {termToggle}
            </div>
          )}
          {/* Siempre los dos paneles montados (no se pierde el estado del explorador ni de los editores):
              según el modo, el CSS oculta uno de ellos. */}
          <Group
            orientation="horizontal"
            className="sv-split"
            data-mode={mode}
            disabled={mode !== "split"}
            defaultLayout={lay.defaultSplit}
            onLayoutChanged={lay.onSplitChanged}
          >
            <Panel id="side" data-sv-panel="side" minSize="200px" className="sv-col" style={{ overflow: "hidden" }}>
              {mode === "split" && (
                <div className="sv-tabs" role="tablist" aria-label="Vistas">
                  <FixedTabs isOn={(id) => side === id} onPick={w.setSide} paletteKeys={paletteKeys} />
                  <div className="sv-tabs-fill" />
                  {detachedButton}
                </div>
              )}
              <SidePanes
                sessionId={sessionId}
                profileId={tab.profileId}
                initialPath={tab.initialPath}
                side={side}
                mounted={mounted}
                visible={active && sideVisible}
                connected={connected}
                openFile={w.openFile}
                onPathChange={onPathChange}
              />
            </Panel>
            <Separator className="app-sep app-sep-v sv-split-sep">
              <span className="app-sep-grip" />
            </Separator>
            <Panel id="editors" data-sv-panel="editors" minSize="260px" className="sv-col sv-editors" style={{ overflow: "hidden" }}>
              {mode === "split" && (
                <div className="sv-tabs" role="tablist" aria-label="Archivos abiertos">
                  {fileTabs((p) => current === p)}
                  <div className="sv-tabs-fill" />
                  {windowButton}
                  <button
                    className="icon-btn sv-bar-btn on"
                    onClick={unsplit}
                    title={withShortcut("Quitar división", splitKeys)}
                    aria-label="Quitar división"
                    aria-pressed
                  >
                    <Columns2 size={15} />
                  </button>
                  {termToggle}
                </div>
              )}
              <EditorPanes
                sessionId={sessionId}
                stable={stable}
                current={current}
                visible={active && editorsVisible}
                connected={connected}
                editors={w.editors}
                onDirtyChange={(p, d) => w.setDirty(sessionId, p, d)}
              />
            </Panel>
          </Group>
        </Panel>
        <Separator className="app-sep app-sep-h">
          <span className="app-sep-grip" />
        </Separator>
        <Panel
          id="terminal"
          panelRef={lay.termPanel}
          collapsible
          collapsedSize={0}
          minSize="90px"
          className="sv-terminal"
          style={{ overflow: "hidden" }}
          onResize={lay.onTermResize}
        >
          <TerminalArea sessionId={sessionId} active={active && !lay.termCollapsed} disabled={closed} />
        </Panel>
      </Group>
      {tabMenu && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          items={fileTabMenuItems({
            path: tabMenu.path,
            connected,
            split,
            side,
            splitHint: splitKeys || undefined,
            detachFile: (p) => void detachFile(p),
            unsplit,
            splitWith,
            closeFile: (p) => void closeFile(p),
          })}
          onClose={closeTabMenu}
        />
      )}
      {drag.ghostPath && <TabDragGhost path={drag.ghostPath} ghostRef={drag.ghostRef} />}
    </div>
  );
});
