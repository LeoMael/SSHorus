// Ejecución aparte con estado (en curso / resultado / error) y cancelación desde la interfaz.
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/core";
import { newExecId, snippets } from "../../api/snippets";
import { CAPTURE_TIMEOUT_SECS, captureExec, confirmDangerous } from "./actions";
import { execWithSudo, sudoFailureText } from "../../features/sudoRun";
import type { ExecResult } from "../../api/types";
import type { RunState } from "./parts";
import type { CommandItem } from "./state";

/** Con la contraseña de sudo de SSHorus (no la de la terminal). Un texto si sudo no llegó a ejecutarlo. */
async function runSudo(sessionId: string, item: CommandItem, command: string, execId: string): Promise<ExecResult | string> {
  const r = await execWithSudo(sessionId, command, {
    timeoutSecs: CAPTURE_TIMEOUT_SECS,
    execId,
    action: `ejecutar «${item.name}»`,
  });
  if (!r) return "Cancelado: sin contraseña de sudo.";
  return r.sudoFailure ? sudoFailureText(r.sudoFailure) : r;
}

export function useRun(sessionId: string | null) {
  const [state, setState] = useState<RunState | null>(null);
  const token = useRef(0);
  /** Ejecución que se está esperando (para poder cancelarla en el servidor). */
  const execId = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = useCallback(
    async (item: CommandItem, command: string) => {
      if (!sessionId) return;
      if (!(await confirmDangerous(item, command))) return;
      const my = ++token.current;
      const id = newExecId();
      execId.current = id;
      setState({ running: true, command, result: null, error: null, startedAt: Date.now() });
      try {
        const result = item.sudo ? await runSudo(sessionId, item, command, id) : await captureExec(sessionId, command, id);
        if (!mounted.current || my !== token.current) return;
        if (typeof result === "string") setState({ running: false, command, result: null, error: result, startedAt: 0 });
        else setState({ running: false, command, result, error: null, startedAt: 0 });
      } catch (e) {
        if (!mounted.current || my !== token.current) return;
        setState({ running: false, command, result: null, error: errorMessage(e), startedAt: 0 });
      } finally {
        if (execId.current === id) execId.current = null;
      }
    },
    [sessionId],
  );

  /** Deja de esperar y detiene el comando también en el servidor (TERM y, si no basta, KILL). */
  const cancel = useCallback(() => {
    token.current++;
    const id = execId.current;
    execId.current = null;
    if (id) snippets.cancelExec(id).catch(() => {});
    setState((s) => (s ? { ...s, running: false, error: "Cancelado. Se pidió al servidor detener el comando." } : s));
  }, []);

  /**
   * Quita el resultado. Si aún se estaba ejecutando (p. ej. volver a la lista en la paleta), el comando
   * sigue en el servidor hasta terminar o vencer su límite: solo «Cancelar» lo detiene.
   */
  const clear = useCallback(() => {
    token.current++;
    execId.current = null;
    setState(null);
  }, []);

  return { state, start, cancel, clear };
}
