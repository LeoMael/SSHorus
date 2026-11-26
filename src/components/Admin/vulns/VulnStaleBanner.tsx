// Aviso cuando el informe en pantalla es de antes de un reinicio del servidor (features/vulnscan/stale.ts):
// así no se confunde «sigue en la lista» con «sigue vulnerable». Se mira una vez por informe, sin sudo.
import { useEffect, useState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import type { Report } from "../../../api/vulnscan";
import { bootNow, staleReason } from "../../../features/vulnscan";

export function VulnStaleBanner({ sessionId, report, disabled, checking, onRecheck }: { sessionId: string; report: Report; disabled: boolean; checking: boolean; onRecheck: () => void }) {
  const [reason, setReason] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (disabled) return;
    let alive = true;
    bootNow(sessionId)
      .then((now) => {
        const text = staleReason(report, now);
        if (alive) setReason(text ? { id: report.id, text } : null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sessionId, report, disabled]);
  if (!reason || reason.id !== report.id) return null;
  return (
    <div className="adm-banner adm-banner-warn" role="status">
      <TriangleAlert size={14} />
      <span className="adm-banner-text">{reason.text}</span>
      <button className="btn btn-sm" onClick={onRecheck} disabled={disabled || checking}>
        <RefreshCw size={13} /> Volver a comprobar
      </button>
    </div>
  );
}
