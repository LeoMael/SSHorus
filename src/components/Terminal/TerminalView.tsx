// Una terminal (xterm.js + shell remota). Se mantiene montada aunque esté oculta.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSettings } from "../../stores/settings";
import { TermController, type TermBackend, type ConnState, type TermStatus, type TmuxState } from "./termController";
import { cleanCopiedText } from "./termText";
import { TermMenu, type MenuState } from "./TermMenu";
import { TermSearchBar } from "./TermSearchBar";

interface TerminalViewProps {
  sessionId: string;
  /** Otra fuente de shell (terminal local). Fija durante la vida de la vista. */
  backend?: TermBackend | null;
  /** «Enviar a la IA» en el menú contextual (con texto seleccionado). */
  onSendToAi?: (text: string) => void;
  /** Sesión tmux de esta terminal (null = shell normal). Fija durante la vida de la vista. */
  tmuxName: string | null;
  /** Volcar el historial de la sesión tmux al abrirla (se reabre una que ya existía). */
  tmuxReplay: boolean;
  onTmux?: (s: TmuxState) => void;
  /** Es la terminal visible (pestaña de conexión activa y sub-pestaña elegida). */
  visible: boolean;
  disabled: boolean;
  /** Estado de la conexión de la pestaña. */
  connState: ConnState;
  /** Sube en cada reconexión exitosa: reabrir la shell si murió con la caída. */
  reconnectCount: number;
  onStatus: (s: TermStatus) => void;
  /** Entrega el controlador al montar (y null al desmontar). */
  onController?: (ctrl: TermController | null) => void;
}

export function TerminalView({
  sessionId,
  backend = null,
  onSendToAi,
  tmuxName,
  tmuxReplay,
  onTmux,
  visible,
  disabled,
  connState,
  reconnectCount,
  onStatus,
  onController,
}: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<TermController | null>(null);
  const onStatusRef = useRef(onStatus);
  const onControllerRef = useRef(onController);
  const onTmuxRef = useRef(onTmux);
  const [menu, setMenu] = useState<MenuState | null>(null);
  /** Contador que abre (o vuelve a enfocar) la barra de búsqueda. */
  const [searchSeq, setSearchSeq] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  /** El controlador como estado (para renderizar la búsqueda sin leer refs al renderizar). */
  const [ctrlState, setCtrlState] = useState<TermController | null>(null);
  const fontSize = useSettings((s) => s.settings.terminalFontSize);
  const fontFamily = useSettings((s) => s.settings.terminalFontFamily);
  const lastReconnect = useRef(reconnectCount);

  useLayoutEffect(() => {
    onStatusRef.current = onStatus;
    onControllerRef.current = onController;
    onTmuxRef.current = onTmux;
  });

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setSearchSeq((n) => n + 1);
  }, []);

  // Crear/destruir la terminal. Ajustes y estado se pasan después sin recrearla.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const s = useSettings.getState().settings;
    const ctrl = new TermController(host, {
      sessionId,
      backend,
      tmuxName,
      tmuxReplay,
      onTmux: (st) => onTmuxRef.current?.(st),
      fontSize: s.terminalFontSize,
      fontFamily: s.terminalFontFamily,
      disabled,
      connState,
      onStatus: (st) => onStatusRef.current(st),
      onSearchRequest: openSearch,
    });
    ctrlRef.current = ctrl;
    setCtrlState(ctrl);
    onControllerRef.current?.(ctrl);
    return () => {
      onControllerRef.current?.(null);
      setCtrlState(null);
      ctrl.dispose();
      ctrlRef.current = null;
    };
    // `disabled`/`connState` iniciales bastan: los cambios llegan por sus setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    ctrlRef.current?.setConnState(connState);
  }, [connState]);

  useEffect(() => {
    if (reconnectCount > lastReconnect.current) ctrlRef.current?.reconnected();
    lastReconnect.current = reconnectCount;
  }, [reconnectCount]);

  useEffect(() => {
    ctrlRef.current?.setFont(fontSize, fontFamily);
  }, [fontSize, fontFamily]);

  useEffect(() => {
    ctrlRef.current?.setDisabled(disabled);
  }, [disabled]);

  useEffect(() => {
    if (visible) ctrlRef.current?.show(!searchOpen);
    else setMenu(null);
    // Solo al cambiar la visibilidad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    ctrlRef.current?.clearSearch();
    ctrlRef.current?.focus();
  }, []);

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    setMenu({ x: e.clientX, y: e.clientY, hasSelection: ctrl.hasSelection() });
  };

  return (
    <div className={`term-view${visible ? " visible" : ""}`} onContextMenu={onContextMenu}>
      <div className="term-host" ref={hostRef} />
      {searchOpen && ctrlState && <TermSearchBar ctrl={ctrlState} focusSeq={searchSeq} onClose={closeSearch} />}
      {menu && (
        <TermMenu
          {...menu}
          onClose={() => {
            setMenu(null);
            ctrlRef.current?.focus();
          }}
          onCopy={() => ctrlRef.current?.copy()}
          onPaste={() => ctrlRef.current?.paste()}
          onSelectAll={() => ctrlRef.current?.selectAll()}
          onClear={() => ctrlRef.current?.clear()}
          onSearch={openSearch}
          onSendToAi={
            onSendToAi
              ? () => {
                  const text = cleanCopiedText(ctrlRef.current?.term.getSelection() ?? "");
                  if (text.trim()) onSendToAi(text);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
