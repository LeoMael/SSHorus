// Diálogos de la contraseña de sudo que no son de un panel (cola de features/privileges/sudoAsk.ts):
// comandos del asistente que ya aprobaste, «Ejecutar en varios servidores» y comandos con sudo. Es el
// mismo SudoDialog de los paneles: si la contraseña ya está (en memoria, guardada u otra pestaña) se cierra
// solo; si no, la pide. Se cierra al bloquear SSHorus o cuando el motor deja de esperar.
import { lazy, Suspense, useEffect } from "react";
import { useLock } from "../../features/lock/lockStore";
import { cancelAllSudoAsks, finishSudoAsk, useSudoAsks } from "../../features/privileges";
import "./Sudo.css";

const SudoDialog = lazy(() => import("./SudoDialog").then((m) => ({ default: m.SudoDialog })));

export function SudoAskHost() {
  const first = useSudoAsks((s) => s.asks[0]);
  const locked = useLock((s) => !!s.status?.locked);

  // También lo que llegue a la cola estando bloqueado: no debe aparecer al desbloquear.
  useEffect(() => {
    if (locked && first) cancelAllSudoAsks();
  }, [locked, first]);

  useEffect(() => {
    if (!first || first.expiresAt === undefined) return;
    const t = window.setTimeout(() => finishSudoAsk(first.id), Math.max(0, first.expiresAt - Date.now()));
    return () => window.clearTimeout(t);
  }, [first]);

  if (!first || locked) return null;
  return (
    <div className="sudo-ask">
      <Suspense fallback={null}>
        <SudoDialog
          key={first.id}
          sessionId={first.sessionId}
          profileId={first.profileId}
          user={first.user}
          cancelLabel={first.cancelLabel}
          reason={first.reason}
          onClose={() => finishSudoAsk(first.id)}
        />
      </Suspense>
    </div>
  );
}
