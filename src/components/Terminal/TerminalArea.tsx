// Zona de terminales de una pestaña de conexión: sub-pestañas + una xterm por shell.
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { LayersIcon, Plus, RefreshCw, SquareTerminal, Unplug } from "lucide-react";
import { TerminalView } from "./TerminalView";
import { TmuxSessionsDialog } from "./TmuxSessionsDialog";
import { SudoPasswordButton } from "./SudoPasswordButton";
import { ClaudeVpsButton } from "./ClaudeVpsButton";
import type { ConnState, TermController, TermStatus, TmuxState } from "./termController";
import { useTabs } from "../../stores/tabs";
import { registerTerminalWriter } from "../../stores/terminalBus";
import { toast } from "../../stores/toasts";
import { terminal } from "../../api/terminal";
import { sendToAi } from "../../features/localterm/launch";
import { ContextMenu } from "../ui/ContextMenu";
import {
  allOpenTmuxNames,
  detachedLeftovers,
  killTmuxSessions,
  newTmuxName,
  setOpenTmux,
  useTmuxMode,
  warnTmuxMissing,
} from "../../features/tmux";
import { initialTabs, newTab, type SubTab } from "./subTabs";
import { TermTabStrip } from "./TermTabStrip";
import { termTabMenuItems } from "./termTabMenu";
import "./Terminal.css";

export interface TerminalAreaProps {
  sessionId: string;
  /** Pestaña visible: solo entonces se ajusta el tamaño y toma el foco. */
  active: boolean;
  /** true si la conexión se cerró: no abrir terminales nuevas. */
  disabled: boolean;
}

interface TabMenuState {
  x: number;
  y: number;
  key: number;
}

export const TerminalArea = memo(function TerminalArea({ sessionId, active, disabled }: TerminalAreaProps) {
  const [tabs, setTabs] = useState<SubTab[]>(() => initialTabs(sessionId, disabled));
  const [activeKey, setActiveKey] = useState<number | null>(() => tabs[0]?.key ?? null);
  const ctrls = useRef(new Map<number, TermController>());
  const [tabMenu, setTabMenu] = useState<TabMenuState | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  /** Sesiones tmux sueltas en el servidor (nadie las mira y no están abiertas aquí). */
  const [leftovers, setLeftovers] = useState(0);

  const profileId = useTabs((s) => s.tabs.find((t) => t.sessionId === sessionId)?.profileId ?? null);
  const serverName = useTabs((s) => s.tabs.find((t) => t.sessionId === sessionId)?.title ?? "");
  const tmuxMode = useTmuxMode(profileId);

  // Estado de la conexión de esta pestaña.
  const tabStatus = useTabs((s) => s.tabs.find((t) => t.sessionId === sessionId)?.status ?? "connected");
  const attempt = useTabs((s) => s.tabs.find((t) => t.sessionId === sessionId)?.reconnect ?? null);
  const reconnectCount = useTabs((s) => s.tabs.find((t) => t.sessionId === sessionId)?.reconnectCount ?? 0);
  const connState: ConnState = disabled ? "closed" : tabStatus;
  const reconnecting = connState === "reconnecting";
  const blocked = connState !== "connected";

  // La terminal activa de la sesión recibe el texto de la Biblioteca de comandos
  // (mismo camino ordenado que el teclado) y se deja a la vista con el foco.
  useEffect(() => {
    if (activeKey === null || disabled) return;
    return registerTerminalWriter(sessionId, (text) => {
      const c = ctrls.current.get(activeKey);
      c?.sendText(text);
      c?.reveal();
    });
  }, [sessionId, activeKey, disabled]);

  /** Nueva terminal. `tmuxName`: reabrir esa sesión tmux (de «Sesiones en el servidor»). */
  const addTab = useCallback(
    (tmuxName?: string) => {
      if (blocked) return;
      const used = new Set(tabs.map((p) => p.num));
      let num = 1;
      while (used.has(num)) num++;
      const name = tmuxName ?? (tmuxMode === "never" ? null : newTmuxName());
      const t = newTab(num, name, tmuxName !== undefined);
      setTabs((prev) => [...prev, t]);
      setActiveKey(t.key);
    },
    [blocked, tabs, tmuxMode],
  );

  /**
   * Cierra una sub-pestaña. Cerrarla a propósito termina su sesión tmux (como una shell normal);
   * con `detach` la sesión sigue en el servidor y aparece en «Sesiones en el servidor».
   * Sin conexión no se puede terminar: queda en el servidor.
   */
  const closeTab = useCallback(
    (key: number, detach = false) => {
      const idx = tabs.findIndex((t) => t.key === key);
      const t = tabs[idx];
      if (t?.tmux && t.persistent && !detach && connState === "connected") {
        void killTmuxSessions(sessionId, [t.tmux]);
      }
      const rest = tabs.filter((t) => t.key !== key);
      setTabs((prev) => prev.filter((t) => t.key !== key));
      if (key === activeKey) setActiveKey(rest[Math.max(0, idx - 1)]?.key ?? null);
    },
    [tabs, activeKey, connState, sessionId],
  );

  // Registro de las sesiones tmux abiertas (para cerrar la pestaña, «Reconectar» y la lista).
  useEffect(() => {
    for (const t of tabs) if (t.persistent && t.tmux) setOpenTmux(sessionId, t.key, t.tmux);
    return () => {
      for (const t of tabs) setOpenTmux(sessionId, t.key, null);
    };
  }, [tabs, sessionId]);

  const modeRef = useRef(tmuxMode);
  const nameRef = useRef(serverName);
  useEffect(() => {
    modeRef.current = tmuxMode;
    nameRef.current = serverName;
  });

  /** «Enviar a la IA»: la selección va a la pestaña del asistente (o abre uno). */
  const onSendToAi = useCallback((text: string) => void sendToAi(text, nameRef.current || null), []);

  const onTmux = useCallback(
    (key: number, st: TmuxState) => {
      setTabs((prev) => prev.map((t) => (t.key === key && t.persistent !== st.persistent ? { ...t, persistent: st.persistent } : t)));
      // En «Automático» no se avisa nunca; en «Siempre», una vez por servidor.
      if (st.persistent || modeRef.current !== "always" || !profileId) return;
      if (st.missing) void warnTmuxMissing(sessionId, profileId, nameRef.current);
      else if (st.problem) toast.error("No se pudo usar tmux: la terminal no es persistente", st.problem);
    },
    [sessionId, profileId],
  );

  // ¿Quedaron sesiones tmux sueltas en el servidor (p. ej. tras cerrar la app)? Se muestra un contador.
  const checkLeftovers = useCallback(async () => {
    try {
      const l = await terminal.tmuxList(sessionId);
      setLeftovers(detachedLeftovers(l.sessions, allOpenTmuxNames()).length);
    } catch {
      /* sin respuesta: no se muestra nada */
    }
  }, [sessionId]);

  useEffect(() => {
    if (connState !== "connected" || tmuxMode === "never") return;
    // Se espera a que las terminales abran (o se reenganchen) para no contarlas como sueltas.
    const t = setTimeout(() => void checkLeftovers(), 2500);
    return () => clearTimeout(t);
  }, [connState, reconnectCount, tmuxMode, checkLeftovers]);

  const setStatus = useCallback((key: number, status: TermStatus) => {
    setTabs((prev) => prev.map((t) => (t.key === key && t.status !== status ? { ...t, status } : t)));
  }, []);

  return (
    <div className="term-area">
      <div className="term-bar">
        <TermTabStrip
          tabs={tabs}
          activeKey={activeKey}
          onActivate={setActiveKey}
          onClose={closeTab}
          onMenu={(x, y, key) => setTabMenu({ x, y, key })}
        />
        <button
          type="button"
          className="icon-btn term-add"
          onClick={() => addTab()}
          disabled={blocked}
          title={disabled ? "Conexión cerrada" : reconnecting ? "Reconectando…" : "Nueva terminal"}
          aria-label="Nueva terminal"
        >
          <Plus size={15} />
        </button>
        <button
          type="button"
          className="icon-btn term-add term-sessions-btn"
          onClick={() => setShowSessions(true)}
          disabled={blocked}
          title={
            leftovers > 0
              ? `${leftovers === 1 ? "Hay 1 terminal persistente suelta" : `Hay ${leftovers} terminales persistentes sueltas`} en el servidor: reábrelas o ciérralas`
              : "Terminales persistentes en el servidor (tmux)"
          }
          aria-label="Terminales persistentes en el servidor"
        >
          <LayersIcon size={14} />
          {leftovers > 0 && !blocked && <span className="term-sessions-badge">{leftovers}</span>}
        </button>
        <SudoPasswordButton
          sessionId={sessionId}
          profileId={profileId}
          serverName={serverName}
          disabled={blocked || activeKey === null}
          getController={() => (activeKey === null ? undefined : ctrls.current.get(activeKey))}
        />
        <ClaudeVpsButton
          sessionId={sessionId}
          serverName={serverName}
          disabled={blocked || activeKey === null}
          getController={() => (activeKey === null ? undefined : ctrls.current.get(activeKey))}
        />
      </div>

      <div className="term-body">
        {tabs.map((t) => (
          <TerminalView
            key={t.key}
            sessionId={sessionId}
            onSendToAi={onSendToAi}
            visible={active && t.key === activeKey}
            disabled={disabled}
            connState={connState}
            reconnectCount={reconnectCount}
            tmuxName={t.tmux}
            tmuxReplay={t.replay}
            onTmux={(st) => onTmux(t.key, st)}
            onStatus={(s) => setStatus(t.key, s)}
            onController={(c) => {
              if (c) ctrls.current.set(t.key, c);
              else ctrls.current.delete(t.key);
            }}
          />
        ))}
        {tabs.length === 0 && (
          <div className="empty-state term-empty">
            <SquareTerminal size={22} />
            <span>
              {disabled ? "Conexión cerrada" : reconnecting ? "Reconectando…" : "No hay terminales abiertas"}
            </span>
            {!blocked && (
              <button type="button" className="btn btn-sm" onClick={() => addTab()}>
                <Plus size={14} /> Nueva terminal
              </button>
            )}
          </div>
        )}
        {disabled && tabs.length > 0 && (
          <div className="term-overlay" role="status">
            <Unplug size={14} /> Conexión cerrada
          </div>
        )}
        {reconnecting && tabs.length > 0 && (
          <div
            className="term-overlay reconnecting"
            role="status"
            title={attempt?.reason ?? undefined}
          >
            <RefreshCw size={13} className="term-overlay-spin" />
            Reconectando…
            {attempt && ` (intento ${attempt.attempt}/${attempt.maxAttempts})`}
          </div>
        )}
      </div>
      {tabMenu && (
        <ContextMenu x={tabMenu.x} y={tabMenu.y} items={termTabMenuItems(tabs.find((x) => x.key === tabMenu.key), {
            blocked,
            onNew: () => addTab(),
            onSessions: () => setShowSessions(true),
            onClose: (detach) => closeTab(tabMenu.key, detach),
          })} onClose={() => setTabMenu(null)} />
      )}
      {showSessions && (
        <TmuxSessionsDialog
          sessionId={sessionId}
          onOpen={(name) => addTab(name)}
          onClose={() => {
            setShowSessions(false);
            void checkLeftovers();
          }}
        />
      )}
    </div>
  );
});
