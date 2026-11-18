// Avisos de conexión arriba de la pestaña: «Reconectando…» (con cuenta atrás) y «Conexión perdida».
import { useEffect, useState } from "react";
import { RotateCw, Unplug } from "lucide-react";
import type { SessionReconnecting } from "../../api/types";
import type { SessionTab } from "../../stores/tabs";
import { cancelReconnect, reconnectTab, requestCloseTab } from "./sessionState";

/** Segundos que faltan para el próximo intento (cuenta atrás en vivo). */
/** Solo corre mientras la pestaña se ve (las ocultas no gastan un temporizador). */
function useCountdown(info: SessionReconnecting | null, visible: boolean): number | null {
  const [left, setLeft] = useState<number | null>(null);
  const [deadline, setDeadline] = useState<{ info: SessionReconnecting; at: number } | null>(null);
  // El plazo se fija al llegar el aviso, aunque la pestaña esté oculta.
  if (info && deadline?.info !== info) setDeadline({ info, at: Date.now() + info.nextRetrySecs * 1000 });
  else if (!info && deadline) setDeadline(null);
  useEffect(() => {
    if (!deadline) {
      setLeft(null);
      return;
    }
    if (!visible) return;
    const at = deadline.at;
    // setLeft con el mismo número no vuelve a dibujar: basta con mirar 4 veces por segundo.
    const tick = () => setLeft(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [deadline, visible]);
  return left;
}

export function ReconnectingBanner({ tab, visible }: { tab: SessionTab; visible: boolean }) {
  const r = tab.reconnect;
  const left = useCountdown(r, visible);
  return (
    <div className="sv-banner sv-banner-warn" role="status" aria-live="polite">
      <span className="spinner sv-banner-spinner" />
      <span className="sv-banner-text">
        <strong>{r?.waitingUnlock ? "Esperando el desbloqueo…" : "Reconectando…"}</strong>
        {r && !r.waitingUnlock && (
          <>
            {" "}
            intento {r.attempt} de {r.maxAttempts}
            {" · "}
            {left === null || left > 0 ? `próximo en ${left ?? r.nextRetrySecs} s` : "intentando ahora"}
          </>
        )}
        {r?.reason && <span className="sv-banner-reason"> — {r.reason}</span>}
      </span>
      <button className="btn btn-sm" onClick={() => void cancelReconnect(tab.id)} title="Dejar de reintentar">
        Cancelar
      </button>
    </div>
  );
}

export function ClosedBanner({ tab }: { tab: SessionTab }) {
  return (
    <div className="sv-banner" role="alert">
      <Unplug size={15} />
      <span className="sv-banner-text">
        <strong>Conexión perdida</strong>
        {tab.closedReason ? `: ${tab.closedReason}` : ""}
      </span>
      <button className="btn btn-sm btn-primary" onClick={() => void reconnectTab(tab.id)}>
        <RotateCw size={13} /> Reconectar
      </button>
      <button className="btn btn-sm" onClick={() => void requestCloseTab(tab.id)}>
        Cerrar
      </button>
    </div>
  );
}
