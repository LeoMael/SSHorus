// Piezas sueltas del lienzo del mapa: botones de zoom, minimapa y «Actualizado hace…».
import { useEffect, useState, type PointerEvent as RPointerEvent } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { updatedAgo } from "../../features/infra/freshness";
import type { layoutGraph } from "../../features/infra";
import { MAX_ZOOM, MIN_ZOOM, type Viewport } from "../../features/infra/viewport";
import { isMac } from "../../lib/platform";

/** Botones de zoom en la esquina del lienzo, con el porcentaje (clic en él = ajustar). */
export function ZoomControls({ percent, onIn, onOut, onFit }: { percent: number; onIn: () => void; onOut: () => void; onFit: () => void }) {
  const mod = isMac ? "⌘" : "Ctrl";
  return (
    <div className="im-zoombar" role="group" aria-label="Zoom del mapa" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <button className="icon-btn" onClick={onOut} disabled={percent <= MIN_ZOOM * 100} title={`Alejar (${mod} −)`} aria-label="Alejar">
        <Minus size={14} />
      </button>
      <button className="im-zoom" onClick={onFit} title="Zoom actual — clic para ajustar a la pantalla" aria-label={`Zoom ${percent} %. Ajustar a la pantalla`}>
        {percent}%
      </button>
      <button className="icon-btn" onClick={onIn} disabled={percent >= MAX_ZOOM * 100} title={`Acercar (${mod} +)`} aria-label="Acercar">
        <Plus size={14} />
      </button>
      <span className="im-zoombar-sep" aria-hidden="true" />
      <button className="icon-btn im-zoombar-fit" onClick={onFit} title={`Ajustar a la pantalla (${mod} 0)`} aria-label="Ajustar a la pantalla">
        <Maximize size={14} /> <span>Ajustar</span>
      </button>
    </div>
  );
}

export function MiniMap({
  layout,
  view,
  size,
  onCenter,
}: {
  layout: ReturnType<typeof layoutGraph>;
  view: Viewport;
  size: { w: number; h: number };
  onCenter: (x: number, y: number) => void;
}) {
  const W = 170;
  const s = W / layout.width;
  const H = Math.min(130, layout.height * s);
  const sc = Math.min(s, H / layout.height);
  const go = (e: RPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onCenter((e.clientX - r.left) / sc, (e.clientY - r.top) / sc);
  };
  return (
    <svg
      className="im-mini"
      width={layout.width * sc}
      height={layout.height * sc}
      onPointerDown={(e) => {
        e.stopPropagation();
        go(e);
      }}
      onPointerUp={(e) => e.stopPropagation()}
      aria-hidden="true"
    >
      {layout.servers.map((x) => (
        <rect key={x.id} x={x.x * sc} y={x.y * sc} width={x.w * sc} height={x.h * sc} rx={2} className="im-mini-server" />
      ))}
      {[...layout.nodes.values()].map((p) => (
        <rect key={p.node.id} x={p.x * sc} y={p.y * sc} width={p.w * sc} height={p.h * sc} className={`im-mini-node im-h-${p.node.health}`} />
      ))}
      <rect x={(-view.x / view.k) * sc} y={(-view.y / view.k) * sc} width={(size.w / view.k) * sc} height={(size.h / view.k) * sc} className="im-mini-view" />
    </svg>
  );
}

/** «Actualizado hace 3 min» (se refresca solo cada 30 s). */
export function UpdatedAgo({ at, loading }: { at: number | null; loading: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [at]);
  if (at == null) return null;
  const date = new Date(at).toLocaleString("es");
  return (
    <span className="im-updated faint" title={`Leído el ${date}`} role="status">
      {loading ? "Actualizando…" : `Actualizado ${updatedAgo(at, now)}`}
    </span>
  );
}
