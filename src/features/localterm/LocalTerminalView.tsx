// Pestaña de terminal local: la misma vista xterm.js que las de servidor (tema, búsqueda,
// copiar/pegar, redimensionado), con la shell de este equipo o un asistente de IA (Claude Code, Codex, agy, OpenCode).
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Bot, Laptop, Plug } from "lucide-react";
import { localTerm } from "../../api/localterm";
import { TerminalView } from "../../components/Terminal/TerminalView";
import type { TermController, TermStatus } from "../../components/Terminal/termController";
import { onTerminalExit } from "../../components/Terminal/exitEvents";
import "../../components/Terminal/Terminal.css";
import "../../components/Session/SessionView.css";
import { kindLabel } from "./logic";
import { pasteWhenReady } from "./launch";
import { getLocalController, setLocalController, setLocalSession, updateLocalTab, type LocalTab } from "./store";
import { LocalSession, type LocalApi } from "./session";
import { HereMenu } from "./HereMenu";
import "./LocalTerm.css";

/** Para escribir en la shell recién abierta: se espera a que dibuje su prompt (máx. 1,5 s). */
const INPUT_WAIT_MS = 1500;

const LOCAL_API: LocalApi = { ...localTerm, onExit: onTerminalExit };

export const LocalTerminalView = memo(function LocalTerminalView({ tab, active }: { tab: LocalTab; active: boolean }) {
  // Lo que se lanza solo la primera vez: al terminar el asistente, Enter abre una shell normal.
  const launchRef = useRef(tab.launch);
  const ctrlRef = useRef<TermController | null>(null);
  const tabId = tab.id;
  const cwd = tab.cwd;

  const backend = useMemo(
    () =>
      new LocalSession(LOCAL_API, async (cols, rows, onData) => {
        const launch = launchRef.current;
        launchRef.current = null;
        const r = await localTerm.open({ cwd, cols, rows, launch }, onData);
        if (launch) updateLocalTab(tabId, { mcp: r.mcp, aiAlive: true });
        if (r.warning) ctrlRef.current?.note(r.warning);
        return { termId: r.termId };
      }),
    [tabId, cwd],
  );

  useEffect(() => {
    setLocalSession(tabId, backend);
    return () => {
      setLocalSession(tabId, null);
      backend.dispose();
    };
  }, [tabId, backend]);

  const firstRun = useRef(true);
  const onStatus = useCallback(
    (status: TermStatus) => {
      updateLocalTab(tabId, status === "exited" ? { status, aiAlive: false } : { status });
      if (status !== "running" || !firstRun.current) return;
      firstRun.current = false;
      const { initialInput, pendingPaste } = tab;
      if (initialInput) {
        updateLocalTab(tabId, { initialInput: null });
        const start = Date.now();
        const tick = () => {
          const c = ctrlRef.current;
          if (!c) return;
          if (c.acceptsBracketedPaste() || Date.now() - start > INPUT_WAIT_MS) c.sendText(initialInput);
          else setTimeout(tick, 100);
        };
        tick();
      }
      if (pendingPaste) {
        updateLocalTab(tabId, { pendingPaste: null });
        void pasteWhenReady(() => getLocalController(tabId), pendingPaste);
      }
    },
    // `tab` se lee solo en la primera apertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabId],
  );

  const onController = useCallback(
    (c: TermController | null) => {
      ctrlRef.current = c;
      setLocalController(tabId, c);
      if (c) for (const line of tab.intro) c.note(line);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabId],
  );

  useEffect(() => () => setLocalController(tabId, null), [tabId]);

  const running = tab.here ?? (tab.kind !== "shell" ? tab.kind : null);
  const isAi = running !== null;
  return (
    <div className={`sv-root lt-root${active ? "" : " sv-hidden"}`} aria-hidden={!active || undefined}>
      <div className="lt-bar">
        {isAi ? <Bot size={14} /> : <Laptop size={14} />}
        <span className="lt-where">Este equipo</span>
        {running && <span className="lt-kind">{kindLabel(running)}</span>}
        <span className="lt-cwd mono" title={tab.cwd ?? "Carpeta personal"}>
          {tab.cwd ?? "~"}
        </span>
        {tab.mcp && (
          <span className="lt-badge" title="El asistente usa el MCP de SSHorus (con tus permisos)">
            <Plug size={11} /> MCP
          </span>
        )}
        <HereMenu tab={tab} />
      </div>
      <div className="term-body">
        <TerminalView
          sessionId={tab.id}
          backend={backend}
          visible={active}
          disabled={false}
          connState="connected"
          reconnectCount={0}
          tmuxName={null}
          tmuxReplay={false}
          onStatus={onStatus}
          onController={onController}
        />
      </div>
    </div>
  );
});
