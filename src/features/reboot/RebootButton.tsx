// Botón «Reiniciar ahora» (escáner, auditoría y Panel de VPS). Mientras dura muestra en qué va; el
// detalle está en el aviso flotante (RebootHost).
import { useEffect, useRef } from "react";
import { Power } from "lucide-react";
import { usePrivilege } from "../privileges";
import { useTabs } from "../../stores/tabs";
import { rebootAccess } from "./commands";
import { isActive, phaseTitle, type RebootRun } from "./progress";
import { keyOfProfile, onRebootDone, requestReboot, useReboots } from "./store";

/** Llama a `cb` cuando termina bien un reinicio de ese servidor (mientras el componente está montado). */
export function useRebootDone(key: string | null, cb: (() => void) | undefined): void {
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  useEffect(() => {
    if (!key) return;
    return onRebootDone((run) => {
      if (run.key === key) ref.current?.();
    });
  }, [key]);
}

/** Reinicio en curso (o terminado) de ese servidor. */
export function useRebootRun(key: string | null): RebootRun | undefined {
  return useReboots((s) => (key ? s.runs[key] : undefined));
}

export function RebootButtonView({ run, disabled, title, onClick }: { run: RebootRun | undefined; disabled?: boolean; title?: string; onClick: () => void }) {
  const busy = !!run && isActive(run.phase);
  return (
    <button
      className="btn btn-sm btn-danger rb-btn"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled || busy}
      title={busy ? "Mira el progreso en el aviso de abajo" : (title ?? "Reinicia el servidor, espera a que vuelva y reconecta")}
    >
      {busy ? <span className="spinner rb-btn-spinner" /> : <Power size={13} />}
      {busy && run ? phaseTitle(run) : "Reiniciar ahora"}
    </button>
  );
}

export function RebootButton({ sessionId, onRebooted }: { sessionId: string; onRebooted?: () => void }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.sessionId === sessionId));
  const key = tab ? keyOfProfile(tab.profileId) : null;
  const run = useRebootRun(key);
  const info = usePrivilege(sessionId);
  useRebootDone(key, onRebooted);
  // Sin detección todavía se deja pulsar: requestReboot la hace.
  const access = info ? rebootAccess(info) : null;
  const why = tab?.status !== "connected" ? "Sin conexión" : access?.tool === null ? access.why : undefined;
  return <RebootButtonView run={run} disabled={!!why} title={why} onClick={() => void requestReboot(sessionId)} />;
}
