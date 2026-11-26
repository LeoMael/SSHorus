// Pestaña "Comandos" dentro de cada conexión (mockup docs/arquitectura/07-biblioteca-comandos.png).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Plus, Search, WifiOff, X } from "lucide-react";
import { Group, Panel } from "react-resizable-panels";
import { useProfiles } from "../../stores/profiles";
import { openPalette } from "./actions";
import { AnalysisReport } from "./AnalysisReport";
import { CATEGORIES, type Distro } from "../../features/commands/catalog";
import { countByCategory, groupCommands, stepSelection } from "../../features/commands/grouping";
import { CommandDetail } from "./CommandDetail";
import { CommandMenu } from "./CommandMenu";
import { CommandsList, type CommandGroup } from "./CommandsList";
import { ImportSnippetsDialog } from "./ImportSnippetsDialog";
import { SnippetDialog, emptySnippet } from "./SnippetDialog";
import {
  MY_CATEGORY,
  buildItems,
  getSessionInfo,
  searchItems,
  useSnippets,
  type CommandItem,
  type SessionInfoCache,
} from "../../features/commands/state";
import { ColSep, INNER_IDS, OUTER_IDS, savedLayout, useLayoutSaver } from "./panelLayout";
import { useCommandActions } from "./useCommandActions";
import { useServerAnalysis } from "./useServerAnalysis";
import "./Commands.css";
import "./CommandsDetail.css";
import "./CommandsRun.css";
import "./CommandsReport.css";
import "./CommandsPalette.css";
import "./CommandsImport.css";
import { useShortcutText } from "../../features/shortcuts/shortcuts";

export interface CommandsPanelProps {
  sessionId: string;
  /** id del servidor guardado (para "Mis comandos" por servidor/proyecto). */
  profileId: string;
  /** Pestaña visible. */
  active: boolean;
  /** true si la conexión no está disponible (cerrada o reconectando). */
  disabled: boolean;
}

const ALL_CATEGORIES = [...CATEGORIES, MY_CATEGORY];

export function CommandsPanel({ sessionId, profileId, active, disabled }: CommandsPanelProps) {
  const paletteKeys = useShortcutText("app.palette");
  const mine = useSnippets((s) => s.list);
  const mineLoaded = useSnippets((s) => s.loaded);
  const loadMine = useSnippets((s) => s.load);
  const projects = useProfiles((s) => s.projects);
  const profilesLoaded = useProfiles((s) => s.loaded);
  const loadProfiles = useProfiles((s) => s.load);

  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [info, setInfo] = useState<SessionInfoCache | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: CommandItem } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { analysis, showReport, setShowReport, runAnalysis } = useServerAnalysis(sessionId, setInfo);
  const actions = useCommandActions(profileId);
  const { dialog, setDialog, importing, setImporting, editItem, duplicateItem, copyToMine, deleteItem } = actions;

  useEffect(() => {
    if (!mineLoaded) void loadMine();
    if (!profilesLoaded) void loadProfiles();
  }, [mineLoaded, loadMine, profilesLoaded, loadProfiles]);

  // Distribución (para dnf/apt/apk): una vez por sesión, al mostrarse la pestaña.
  useEffect(() => {
    if (!active || disabled || info) return;
    let alive = true;
    void getSessionInfo(sessionId).then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, [active, disabled, info, sessionId]);

  const distro: Distro | null = info?.distro ?? null;
  const items = useMemo(() => buildItems(distro, mine, profileId, projects), [distro, mine, profileId, projects]);
  const counts = useMemo(() => countByCategory(items), [items]);

  const searching = query.trim().length > 0;
  const visible = useMemo(
    () => (searching ? searchItems(items, query) : items.filter((i) => i.category === category)),
    [items, query, searching, category],
  );
  const groups: CommandGroup[] = useMemo(() => groupCommands(visible, searching), [visible, searching]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const selected = flat.find((i) => i.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected && flat.length) setSelectedId(flat[0].id);
  }, [selected, flat]);

  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector(`[data-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const move = (delta: number) => {
    const next = stepSelection(flat.map((x) => x.id), selectedId, delta);
    if (next) setSelectedId(next);
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  const showingMine = !searching && category === MY_CATEGORY;

  const [outerLayout] = useState(() => savedLayout("commands", OUTER_IDS, [18, 82]));
  const [innerLayout] = useState(() => savedLayout("commandsList", INNER_IDS, [45, 55]));
  const saveOuter = useLayoutSaver("commands", OUTER_IDS);
  const saveInner = useLayoutSaver("commandsList", INNER_IDS);

  return (
    <div className="cmd-panel" onKeyDown={(e) => e.key === "Escape" && showReport && !analysis?.running && setShowReport(false)}>
      <div className="cmd-toolbar">
        <div className="cmd-search">
          <Search size={14} />
          <input
            className="input"
            placeholder="Buscar comando…"
            value={query}
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowReport(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                move(-1);
              } else if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
          />
          {query ? (
            <button className="icon-btn cmd-search-clear" title="Limpiar" onClick={() => setQuery("")}>
              <X size={13} />
            </button>
          ) : (
            <kbd className="cmd-kbd" title="Abrir la paleta rápida" onClick={() => openPalette()}>
              {paletteKeys || "Paleta"}
            </kbd>
          )}
        </div>
        {info?.osName && (
          <span className="cmd-os faint" title="Sistema detectado">
            {info.osName}
          </span>
        )}
        <span className="cmd-spacer" />
        <button className="btn" onClick={() => setDialog(emptySnippet())}>
          <Plus size={14} /> Nuevo comando
        </button>
        <button
          className="btn btn-primary"
          disabled={disabled || !!analysis?.running}
          title="Informe de solo lectura: sistema, CPU, memoria, discos, procesos, puertos, contenedores y errores"
          onClick={runAnalysis}
        >
          {analysis?.running ? <span className="spinner cmd-spinner-xs" /> : <Activity size={14} />} Analizar servidor
        </button>
      </div>

      {disabled && (
        <div className="cmd-notice">
          <WifiOff size={14} /> La conexión no está disponible: puedes explorar los comandos, pero no ejecutarlos.
        </div>
      )}

      <Group orientation="horizontal" className="cmd-body" defaultLayout={outerLayout} onLayoutChanged={saveOuter}>
        <Panel id="cats" minSize="130px" maxSize="40%" className="cmd-col">
          <nav className="cmd-cats" aria-label="Categorías">
            <div className="section-label cmd-cats-title">Categorías</div>
            {ALL_CATEGORIES.map((c) => (
              <button
                key={c}
                className={`cmd-cat${c === MY_CATEGORY ? " mine" : ""}${!searching && !showReport && c === category ? " active" : ""}`}
                onClick={() => {
                  setCategory(c);
                  setQuery("");
                  setShowReport(false);
                  setSelectedId(null);
                }}
              >
                <span>{c}</span>
                <span className="cmd-count">{counts[c] ?? 0}</span>
              </button>
            ))}
            {analysis?.report && !showReport && (
              <button className="cmd-cat cmd-cat-report" onClick={() => setShowReport(true)}>
                <span>
                  <Activity size={13} /> Último informe
                </span>
              </button>
            )}
          </nav>
        </Panel>
        <ColSep />
        <Panel id="content" minSize="40%" className="cmd-col">
          {showReport && analysis ? (
            <AnalysisReport state={analysis} onRerun={runAnalysis} onClose={() => setShowReport(false)} disabled={disabled} />
          ) : (
            <Group orientation="horizontal" className="cmd-inner" defaultLayout={innerLayout} onLayoutChanged={saveInner}>
              <Panel id="list" minSize="200px" className="cmd-col">
                <CommandsList
                  listRef={listRef}
                  groups={groups}
                  selectedId={selectedId}
                  showingMine={showingMine}
                  searching={searching}
                  query={query}
                  mine={mine}
                  onMove={move}
                  onSelect={setSelectedId}
                  onOpenMenu={(x, y, item) => setMenu({ x, y, item })}
                  onCreateNew={() => setDialog(emptySnippet())}
                  onImportFile={() => void actions.importFromFile()}
                  onImportClipboard={() => void actions.importFromClipboard()}
                />
              </Panel>
              <ColSep />
              <Panel id="detail" minSize="280px" className="cmd-col">
                <div className="cmd-detail-wrap">
                  {selected ? (
                    <CommandDetail
                      key={selected.id}
                      item={selected}
                      sessionId={sessionId}
                      profileId={profileId}
                      disabled={disabled}
                      onEdit={() => editItem(selected)}
                      onDuplicate={() => duplicateItem(selected)}
                      onDelete={() => deleteItem(selected)}
                      onCopyToMine={() => copyToMine(selected)}
                    />
                  ) : (
                    <div className="empty-state">Elige un comando de la lista</div>
                  )}
                </div>
              </Panel>
            </Group>
          )}
        </Panel>
      </Group>

      {menu && <CommandMenu x={menu.x} y={menu.y} items={actions.menuItems(menu.item)} onClose={closeMenu} />}
      {importing && (
        <ImportSnippetsDialog plan={importing.plan} source={importing.source} onClose={() => setImporting(null)} />
      )}
      {dialog && (
        <SnippetDialog
          initial={dialog}
          profileId={profileId}
          onClose={(saved) => {
            setDialog(null);
            if (saved) {
              setQuery("");
              setShowReport(false);
              setCategory(MY_CATEGORY);
              setSelectedId(`my.${saved.id}`);
            }
          }}
        />
      )}
    </div>
  );
}
