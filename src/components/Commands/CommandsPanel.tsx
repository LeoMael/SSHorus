// Pestaña "Comandos" dentro de cada conexión (mockup docs/arquitectura/07-biblioteca-comandos.png).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ClipboardCopy, Copy, CopyPlus, Network, Pencil, Plus, Search, Trash2, WifiOff, X } from "lucide-react";
import { Group, Panel, Separator, type Layout, type LayoutChangedMeta } from "react-resizable-panels";
import { useSettings } from "../../stores/settings";
import { errorMessage } from "../../api/core";
import { snippets as snippetsApi } from "../../api/snippets";
import type { Snippet } from "../../api/types";
import { clipboard } from "../../lib/clipboard";
import { useProfiles } from "../../stores/profiles";
import { toast } from "../../stores/toasts";
import { confirmDialog } from "../ui/dialogs";
import { openPalette } from "./actions";
import { ANALYSIS_COMMAND, ANALYSIS_TIMEOUT_SECS, parseReport } from "../../features/commands/analysis";
import { AnalysisReport, type AnalysisState } from "./AnalysisReport";
import { CATEGORIES, type Distro } from "../../features/commands/catalog";
import { CommandDetail } from "./CommandDetail";
import { CommandMenu, type CommandMenuItem } from "./CommandMenu";
import { CommandsList, type CommandGroup } from "./CommandsList";
import { ImportSnippetsDialog } from "./ImportSnippetsDialog";
import { multiRunBlockedReason, runOnManyServers } from "./multi";
import { SnippetDialog, emptySnippet } from "./SnippetDialog";
import {
  MY_CATEGORY,
  buildItems,
  getSessionInfo,
  searchItems,
  setSessionInfo,
  useSnippets,
  type CommandItem,
  type SessionInfoCache,
} from "../../features/commands/state";
import { pickImportFile, planImport, type ImportPlan } from "./transfer";
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
  const removeMine = useSnippets((s) => s.remove);
  const projects = useProfiles((s) => s.projects);
  const profilesLoaded = useProfiles((s) => s.loaded);
  const loadProfiles = useProfiles((s) => s.load);

  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [info, setInfo] = useState<SessionInfoCache | null>(null);
  const [dialog, setDialog] = useState<Snippet | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [importing, setImporting] = useState<{ plan: ImportPlan; source: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: CommandItem } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) c[it.category] = (c[it.category] ?? 0) + 1;
    return c;
  }, [items]);

  const searching = query.trim().length > 0;
  const visible = useMemo(
    () => (searching ? searchItems(items, query) : items.filter((i) => i.category === category)),
    [items, query, searching, category],
  );

  // Grupos (en búsqueda: "Categoría · grupo" en orden de relevancia del primer elemento).
  const groups = useMemo(() => {
    const out: CommandGroup[] = [];
    const idx = new Map<string, number>();
    for (const it of visible) {
      const label = searching ? `${it.category === MY_CATEGORY ? "Mis comandos" : it.category} · ${it.group}` : it.group;
      let i = idx.get(label);
      if (i === undefined) {
        i = out.length;
        idx.set(label, i);
        out.push({ key: label, label, items: [] });
      }
      out[i].items.push(it);
    }
    return out;
  }, [visible, searching]);
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
    if (!flat.length) return;
    const i = flat.findIndex((x) => x.id === selectedId);
    const next = Math.max(0, Math.min(flat.length - 1, (i < 0 ? -1 : i) + delta));
    setSelectedId(flat[next].id);
  };

  // ───────── Análisis ─────────
  const runAnalysis = useCallback(async () => {
    setShowReport(true);
    setAnalysis((a) => ({
      running: true,
      report: a?.report ?? null,
      raw: a?.raw ?? "",
      stderr: "",
      error: null,
      at: a?.at ?? 0,
      durationMs: 0,
    }));
    try {
      const r = await snippetsApi.exec(sessionId, ANALYSIS_COMMAND, ANALYSIS_TIMEOUT_SECS);
      const report = parseReport(r.stdout, r.timedOut);
      if (report.osId) {
        const next = { distro: report.distro, osId: report.osId, osName: report.osName };
        setSessionInfo(sessionId, next);
        setInfo(next);
      }
      setAnalysis({
        running: false,
        report,
        raw: r.stdout,
        stderr: r.stderr,
        error: r.stdout.trim() ? null : r.stderr.trim() || "El servidor no devolvió datos.",
        at: Date.now(),
        durationMs: r.durationMs,
      });
    } catch (e) {
      setAnalysis((a) => ({
        running: false,
        report: a?.report ?? null,
        raw: a?.raw ?? "",
        stderr: "",
        error: `No se pudo analizar el servidor: ${errorMessage(e)}`,
        at: a?.at ?? 0,
        durationMs: 0,
      }));
    }
  }, [sessionId]);

  // ───────── Mis comandos ─────────
  const editItem = (it: CommandItem) => it.custom && setDialog(it.custom);
  const duplicateItem = (it: CommandItem) =>
    it.custom && setDialog({ ...it.custom, id: "", name: `${it.custom.name} (copia)` });
  const copyToMine = (it: CommandItem) =>
    setDialog({
      ...emptySnippet(),
      name: it.name,
      description: it.description ?? null,
      command: it.command,
      category: it.category,
      dangerous: it.dangerous,
      sudo: it.sudo,
      readOnly: it.readOnly,
    });
  const deleteItem = async (it: CommandItem) => {
    if (!it.custom) return;
    const ok = await confirmDialog({
      title: "¿Eliminar comando?",
      message: `Se eliminará «${it.name}» de Mis comandos.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (ok && (await removeMine(it.custom.id))) toast.success("Comando eliminado");
  };

  const importFromFile = async () => {
    try {
      const picked = await pickImportFile();
      if (picked) setImporting({ plan: planImport(picked.text), source: picked.path });
    } catch (e) {
      toast.error("No se pudo importar", e);
    }
  };
  const importFromClipboard = async () => {
    try {
      setImporting({ plan: planImport(await clipboard.read()), source: "Portapapeles" });
    } catch (e) {
      toast.error("No se pudo importar", e);
    }
  };

  const copyCommand = async (it: CommandItem) => {
    try {
      await clipboard.write(it.command);
      toast.success("Comando copiado");
    } catch (e) {
      toast.error("No se pudo copiar al portapapeles", e);
    }
  };

  const menuItems = (it: CommandItem): CommandMenuItem[] => {
    const multi = multiRunBlockedReason(it);
    const out: CommandMenuItem[] = [
      {
        label: "Ejecutar en varios servidores…",
        icon: <Network size={14} />,
        disabled: !!multi,
        onSelect: () => runOnManyServers(it, profileId),
      },
      { label: "Copiar comando", icon: <ClipboardCopy size={14} />, onSelect: () => void copyCommand(it) },
    ];
    if (it.custom) {
      out.push(
        { label: "Editar…", icon: <Pencil size={14} />, sepBefore: true, onSelect: () => editItem(it) },
        { label: "Duplicar…", icon: <CopyPlus size={14} />, onSelect: () => duplicateItem(it) },
        { label: "Eliminar", icon: <Trash2 size={14} />, danger: true, onSelect: () => void deleteItem(it) },
      );
    } else {
      out.push({ label: "Copiar a Mis comandos…", icon: <Copy size={14} />, sepBefore: true, onSelect: () => copyToMine(it) });
    }
    return out;
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
            ref={searchRef}
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
                  onImportFile={() => void importFromFile()}
                  onImportClipboard={() => void importFromClipboard()}
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

      {menu && <CommandMenu x={menu.x} y={menu.y} items={menuItems(menu.item)} onClose={closeMenu} />}
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

const OUTER_IDS = ["cats", "content"];
const INNER_IDS = ["list", "detail"];

function savedLayout(key: string, ids: string[], fallback: number[]): Layout {
  const saved = useSettings.getState().settings.layout[key];
  const v = saved && saved.length === ids.length && saved.every((n) => n > 0) ? saved : fallback;
  return Object.fromEntries(ids.map((id, i) => [id, v[i]]));
}

function useLayoutSaver(key: string, ids: string[]) {
  const setLayout = useSettings((s) => s.setLayout);
  return useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) return;
      const l = meta.requestedLayout ?? layout;
      setLayout(key, ids.map((id) => l[id] ?? 0));
    },
    [key, ids, setLayout],
  );
}

function ColSep() {
  return (
    <Separator className="app-sep app-sep-v">
      <span className="app-sep-grip" />
    </Separator>
  );
}
