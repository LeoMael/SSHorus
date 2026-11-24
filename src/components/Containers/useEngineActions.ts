// Acciones del panel de Contenedores: ejecutar comandos como su dueño, mostrarlos, mandarlos a la
// terminal y avisar al terminar una revisión.
import { useCallback } from "react";
import { ownerKey, ownerLine, readOwners, runOwned, type Cmd, type EngineRun } from "../../features/containers";
import type { Elevation } from "../../features/privileges";
import { hasTerminal, sendToTerminal } from "../../stores/terminalBus";
import { toast } from "../../stores/toasts";
import type { ReviewRequest } from "./context";
import { combineElevation, otherOwnersText, type ResourceKind } from "../../features/containers/panelLogic";
import type { OwnerScope } from "./useOwnerScope";

type Args = Pick<OwnerScope, "runner" | "resolve" | "currentKey" | "engine" | "elevPrefix" | "selfPrefix" | "label"> & {
  sessionId: string;
  /** El servidor tiene `runuser`. */
  runuser: boolean;
  reload: (...kinds: ResourceKind[]) => Promise<void>;
  askSudo: () => void;
};

export function useEngineActions({
  sessionId,
  runner,
  resolve,
  currentKey,
  engine,
  elevPrefix,
  selfPrefix,
  label,
  runuser,
  reload,
  askSudo,
}: Args) {
  const run = useCallback(
    async (cmds: Cmd[], timeoutSecs = 120): Promise<EngineRun> => {
      const r = await runOwned(runner, cmds, timeoutSecs);
      if (r.needSudo) askSudo();
      return r;
    },
    [runner, askSudo],
  );

  const runRawAs = useCallback(
    async (owner: string | undefined, script: string, timeoutSecs = 30): Promise<EngineRun> => {
      const o = resolve(owner ?? currentKey);
      if (!o) return { ok: false, result: null, error: "No se encontró ese usuario", needSudo: false };
      const r = (await readOwners(runner, [o], script, timeoutSecs)).get(ownerKey(o));
      if (r?.needSudo) askSudo();
      return r ?? { ok: false, result: null, error: "Sin respuesta del servidor", needSudo: false };
    },
    [runner, resolve, currentKey, askSudo],
  );

  /** Comando tal y como se muestra (y se escribe en la terminal): con sudo o como el dueño. */
  const render = useCallback(
    (c: Cmd) => ownerLine(c, resolve(c.owner ?? currentKey) ?? { kind: "self" }, { engine, elevPrefix, selfPrefix, runuser }),
    [resolve, currentKey, engine, elevPrefix, selfPrefix, runuser],
  );

  /** Elevación de unos comandos (null = hace falta sudo y no hay). */
  const elevationOf = useCallback(
    (cmds: Cmd[]): Elevation | null =>
      combineElevation(
        cmds.map((c) => {
          const o = resolve(c.owner ?? currentKey);
          return o ? runner.elevationFor(o) : null;
        }),
      ),
    [resolve, currentKey, runner],
  );

  const onReviewFinished = useCallback(
    (req: ReviewRequest, r: EngineRun) => {
      const detail = typeof req.success === "function" ? req.success(r) : req.success;
      const [title, ...rest] = detail.split("\n");
      toast.success(title, rest.join("\n") || undefined);
      if (req.reload?.length) void reload(...req.reload);
      req.onDone?.(r);
    },
    [reload],
  );

  const toTerminal = useCallback(
    (cmd: Cmd, execute: boolean) => {
      if (!hasTerminal(sessionId)) {
        toast.error("No hay ninguna terminal abierta", "Abre una terminal en esta conexión y vuelve a intentarlo");
        return false;
      }
      const ok = sendToTerminal(sessionId, render(cmd), execute);
      if (ok) toast.info("Enviado a la terminal", execute ? "Cambia a la pestaña Terminal para verlo" : "Revisa el comando y pulsa Enter");
      return ok;
    },
    [sessionId, render],
  );

  const ownerLabel = useCallback(
    (k: string | undefined) => {
      const o = resolve(k ?? currentKey);
      return o ? label(o) : (k ?? "").replace(/^u:/, "");
    },
    [resolve, currentKey, label],
  );

  /** Usuarios afectados por unos comandos (para la revisión). */
  const who = (cmds: Cmd[]) => otherOwnersText(cmds, currentKey, ownerLabel);

  return { run, runRawAs, render, elevationOf, onReviewFinished, toTerminal, ownerLabel, who };
}

export type EngineActions = ReturnType<typeof useEngineActions>;
