// Estructura principal: barra lateral | (pestañas + sesión activa + transferencias).
import { Suspense, useCallback, useEffect, useState } from "react";
import { Group, Panel, Separator, usePanelRef, type Layout, type LayoutChangedMeta } from "react-resizable-panels";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DialogHost } from "./components/ui/dialogs";
import { Toaster } from "./components/ui/Toaster";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { TransferPanel } from "./components/TransferPanel/TransferPanel";
import { ConnectDialogHost } from "./features/connect/ConnectDialogs";
import { EditorsHost, ProjectEditorHost, ServerEditorHost } from "./features/serverEditor/EditorsHost";
import { PaletteHost, PaletteView } from "./components/Commands/PaletteHost";
import { MultiRunHost } from "./components/MultiRun/MultiRunHost";
import { ProjectAuditHost } from "./components/ProjectAudit/ProjectAuditHost";
import { ProjectMapHost } from "./components/InfraMap/ProjectMapHost";
import { FleetHost } from "./components/Fleet/FleetHost";
import { GitHubHost } from "./components/GitHub";
import { initThemeSync } from "./stores/appTheme";
import { requestCloseTab } from "./features/connect/tabLifecycle";
import { TabBar } from "./components/Tabs/TabBar";
import { Welcome, recordRecentServer } from "./components/Welcome/Welcome";
import { useSettings } from "./stores/settings";
import { useProfiles } from "./stores/profiles";
import { initTabsListeners, useTabs } from "./stores/tabs";
import { initTransfersStore } from "./stores/transfers";
import { initPrivileges } from "./features/privileges";
import { PinDialogHost } from "./features/lock/PinDialog";
import { initMcp } from "./features/mcp/store";
import { ApprovalDialogHost } from "./features/mcp/ApprovalDialog";
import { PairDialogHost } from "./components/McpPairing/PairDialog";
import { SudoAskHost } from "./components/Sudo/SudoAskHost";
import { PasswordRunHost } from "./features/mcp/PasswordRunDialog";
import { JobsHost } from "./components/Jobs/JobsHost";
import { McpActivity } from "./components/McpActivity/McpActivity";
import { useUi } from "./stores/ui";
import { closeLocalTab, initLocalTabs, isLocalTabId, useLocalTabs } from "./features/localterm/store";
import { closeFleetTab, fleetTabTitle, isFleetTabId, useFleetTabs } from "./features/fleet/tabs";
import { barTabIds, initTabFallback } from "./features/tabbar/all";
import { ChoiceDialogHost } from "./features/localterm/ChoiceDialog";
import { idleQueue, preloadable } from "./lib/lazy";
import { matchesShortcut } from "./features/shortcuts/shortcuts";
import "./App.css";

// Lo que no hace falta para la primera pantalla va en trozos aparte (arranque más rápido).
// Se precargan en segundo plano cuando la ventana queda ociosa, así abrirlos no espera.
const SessionView = preloadable(() => import("./components/Session/SessionView").then((m) => m.SessionView));
const SettingsDialog = preloadable(() => import("./components/Settings/SettingsDialog").then((m) => m.SettingsDialog));
const LocalTerminalView = preloadable(() =>
  import("./components/Terminal/LocalTerminalView").then((m) => m.LocalTerminalView),
);

function preloadInBackground() {
  idleQueue([
    () => SessionView.preload(),
    () => SettingsDialog.preload(),
    () => LocalTerminalView.preload(),
    () => PaletteView.preload(),
    async () => {
      const m = await import("./components/Session/SessionView");
      await m.CommandsPanel.preload();
    },
    () => Promise.all([ServerEditorHost.preload(), ProjectEditorHost.preload()]),
    // Monaco (~4 MB) al final: abrir un archivo en el editor ya no tiene que esperar a cargarlo.
    () => new Promise((r) => setTimeout(r, 1500)),
    () => import("./components/Editor/RemoteEditor"),
  ]);
}

let initialized = false;

/** Inicialización global (una sola vez). */
function initApp() {
  if (initialized) return;
  initialized = true;
  initThemeSync();
  void useSettings.getState().load();
  void useProfiles.getState().load();
  void initTabsListeners();
  void initTransfersStore();
  initPrivileges(); // root / sudo / usuario normal de cada conexión (en segundo plano)
  initMcp(); // asistentes de IA: permisos, actividad y peticiones del motor
  initLocalTabs(); // pestañas de terminal local («Este equipo»)
  initTabFallback(); // al cerrar la última pestaña de un tipo, mostrar otra

  // Recordar servidores usados (para la pantalla de bienvenida).
  useTabs.subscribe((s, prev) => {
    if (s.tabs.length <= prev.tabs.length) return;
    const old = new Set(prev.tabs.map((t) => t.id));
    for (const t of s.tabs) if (!old.has(t.id)) recordRecentServer(t.profileId);
  });

  // Menú contextual del navegador: solo donde tiene sentido (texto, terminal, editor).
  document.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.("input, textarea, [contenteditable='true'], .xterm, .monaco-editor")) return;
    e.preventDefault();
  });

  // Evitar recargar la ventana por accidente (perdería las pestañas abiertas).
  window.addEventListener("keydown", (e) => {
    if (import.meta.env.DEV) return;
    const k = e.key.toLowerCase();
    if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && k === "r" && !(e.target as HTMLElement | null)?.closest?.(".xterm"))) {
      e.preventDefault();
    }
  });
}

// Al cargar el módulo, no al renderizar <App>: los init* actualizan stores (p. ej. privilegios) y, si
// el módulo se vuelve a evaluar en caliente (HMR), hacerlo en el render avisa «Cannot update a
// component (`ContainersPanel`) while rendering a different component (`App`)».
initApp();

/** Atajos globales de la ventana (configurables en Ajustes → Atajos de teclado). */
function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".modal-backdrop")) return; // hay un diálogo abierto
      const id = WINDOW_SHORTCUTS.find((a) => matchesShortcut(a, e));
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      const tabsState = useTabs.getState();
      const { activeTabId } = tabsState;
      switch (id) {
        case "tabs.next":
        case "tabs.prev":
        case "tabs.nextConn":
        case "tabs.prevConn": {
          // Todas las pestañas (servidor, este equipo, paneles), en el orden de la barra.
          const ids = barTabIds();
          if (ids.length < 2) return;
          const back = id === "tabs.prev" || id === "tabs.prevConn";
          const i = Math.max(0, ids.indexOf(activeTabId ?? ""));
          tabsState.setActive(ids[(i + (back ? -1 : 1) + ids.length) % ids.length]);
          return;
        }
        case "app.settings":
          useUi.getState().openSettings();
          return;
        case "tabs.close": // la conexión entera (Ctrl+Shift+W); Ctrl+W cierra el archivo abierto (useSessionKeys)
          if (activeTabId && isLocalTabId(activeTabId)) closeLocalTab(activeTabId);
          else if (activeTabId && isFleetTabId(activeTabId)) closeFleetTab(activeTabId);
          else if (activeTabId) void requestCloseTab(activeTabId);
          return;
        case "app.sidebar":
          useUi.getState().toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

/** Acciones que maneja la ventana principal (la paleta, el bloqueo y la división tienen el suyo). */
const WINDOW_SHORTCUTS = ["tabs.next", "tabs.prev", "tabs.nextConn", "tabs.prevConn", "app.settings", "tabs.close", "app.sidebar"];

/** Título de la ventana: "SSHorus — <pestaña>". */
function useWindowTitle() {
  const activeId = useTabs((s) => s.activeTabId);
  const sshTitle = useTabs((s) => s.tabs.find((t) => t.id === s.activeTabId)?.title ?? null);
  const localTitle = useLocalTabs((s) => s.tabs.find((t) => t.id === activeId)?.title ?? null);
  const fleetTab = useFleetTabs((s) => s.tabs.find((t) => t.id === activeId) ?? null);
  const projects = useProfiles((s) => s.projects);
  const title = sshTitle ?? (localTitle ? `${localTitle} (este equipo)` : fleetTab ? fleetTabTitle(fleetTab, projects) : null);
  useEffect(() => {
    const t = title ? `SSHorus — ${title}` : "SSHorus";
    document.title = t;
    getCurrentWindow()
      .setTitle(t)
      .catch(() => {
        /* sin permiso para cambiar el título: se ignora */
      });
  }, [title]);
}

function mainLayout(saved: number[] | undefined): Layout {
  if (saved && saved.length === 2 && saved.every((n) => Number.isFinite(n)) && saved[0] >= 8 && saved[0] <= 50) {
    return { sidebar: saved[0], main: saved[1] };
  }
  return { sidebar: 18, main: 82 };
}

function Shell() {
  const tabs = useTabs((s) => s.tabs);
  const localTabs = useLocalTabs((s) => s.tabs);
  const fleetCount = useFleetTabs((s) => s.tabs.length);
  const activeId = useTabs((s) => s.activeTabId);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const setLayout = useSettings((s) => s.setLayout);
  const sidebarRef = usePanelRef();
  const [defaultLayout] = useState(() => mainLayout(useSettings.getState().settings.layout.main));

  // Estado del store → panel (Ctrl+B, botón).
  useEffect(() => {
    const p = sidebarRef.current;
    if (!p || p.isCollapsed() === collapsed) return;
    if (collapsed) p.collapse();
    else p.expand();
  }, [collapsed, sidebarRef]);

  // Panel → store (si el usuario lo pliega arrastrando).
  const onSidebarResize = useCallback(() => {
    const p = sidebarRef.current;
    if (!p) return;
    const isCollapsed = p.isCollapsed();
    if (isCollapsed !== useUi.getState().sidebarCollapsed) useUi.getState().toggleSidebar();
  }, [sidebarRef]);

  const onLayoutChanged = useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) return;
      const l = meta.requestedLayout ?? layout;
      if ((l.sidebar ?? 0) < 5) return; // plegada: conservar el último ancho útil
      setLayout("main", [l.sidebar, l.main]);
    },
    [setLayout],
  );

  return (
    <div className="app">
      <Group orientation="horizontal" className="app-group" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
        <Panel
          id="sidebar"
          panelRef={sidebarRef}
          minSize="180px"
          maxSize="45%"
          collapsible
          collapsedSize={0}
          groupResizeBehavior="preserve-pixel-size"
          onResize={onSidebarResize}
          className="app-sidebar"
          style={{ overflow: "hidden" }}
        >
          <Sidebar />
        </Panel>
        <Separator className="app-sep app-sep-v">
          <span className="app-sep-grip" />
        </Separator>
        <Panel id="main" minSize="40%" className="app-main" style={{ overflow: "hidden" }}>
          <TabBar />
          <div className="app-content">
            {tabs.length > 0 && (
              <Suspense
                fallback={
                  <div className="app-loading">
                    <div className="spinner" />
                  </div>
                }
              >
                {tabs.map((t) => (
                  <SessionView key={t.id} tab={t} active={t.id === activeId} />
                ))}
              </Suspense>
            )}
            {localTabs.length > 0 && (
              <Suspense
                fallback={
                  <div className="app-loading">
                    <div className="spinner" />
                  </div>
                }
              >
                {localTabs.map((t) => (
                  <LocalTerminalView key={t.id} tab={t} active={t.id === activeId} />
                ))}
              </Suspense>
            )}
            <FleetHost activeId={activeId} />
            {tabs.length === 0 && localTabs.length === 0 && fleetCount === 0 && <Welcome />}
          </div>
          <TransferPanel />
        </Panel>
      </Group>
    </div>
  );
}

function SettingsHost() {
  const open = useUi((s) => s.settingsOpen);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <SettingsDialog />
    </Suspense>
  );
}

export default function App() {
  const loaded = useSettings((s) => s.loaded);
  useGlobalShortcuts();
  useWindowTitle();

  useEffect(() => {
    if (loaded) preloadInBackground();
  }, [loaded]);

  return (
    <>
      {loaded ? (
        <Shell />
      ) : (
        <div className="app-boot">
          <div className="spinner" />
        </div>
      )}
      <DialogHost />
      <Toaster />
      <EditorsHost />
      <ConnectDialogHost />
      <SettingsHost />
      <PaletteHost />
      <MultiRunHost />
      <ProjectAuditHost />
      <ProjectMapHost />
      <GitHubHost />
      <PinDialogHost />
      <McpActivity />
      <ApprovalDialogHost />
      <PairDialogHost />
      <ChoiceDialogHost />
      <SudoAskHost />
      <PasswordRunHost />
      <JobsHost />
    </>
  );
}
