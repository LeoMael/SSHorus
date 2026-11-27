// Una entrada de la línea de tiempo: fecha, origen, qué se hizo, quién y resultado; al abrirla, el detalle.
import { memo } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Copy, ExternalLink, XCircle } from "lucide-react";
import { SOURCE_LABEL, resultLabel, type TimelineItem } from "../../features/serverHistory";
import { clipboard } from "../../lib/clipboard";
import { toast } from "../../stores/toasts";

function when(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ResultIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) return <CircleDashed size={13} className="faint" aria-label="Sin resultado" />;
  return ok ? <CheckCircle2 size={13} className="sh-ok" aria-label="Bien" /> : <XCircle size={13} className="sh-bad" aria-label="Falló" />;
}

interface Props {
  item: TimelineItem;
  open: boolean;
  onToggle: (key: string) => void;
  /** Abre el informe completo (auditorías). */
  onOpenReport?: (item: TimelineItem) => void;
}

export const HistoryRow = memo(function HistoryRow({ item, open, onToggle, onOpenReport }: Props) {
  const showDetail = item.detail && item.detail !== item.title;
  return (
    <li className={`sh-row${item.ok === false ? " err" : ""}`}>
      <button className="sh-head" onClick={() => onToggle(item.key)} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <ResultIcon ok={item.ok} />
        <span className="sh-date mono">{when(item.at)}</span>
        <span className={`sh-src sh-src-${item.source}`}>{SOURCE_LABEL[item.source]}</span>
        <span className="sh-title" title={item.title}>
          {item.title}
        </span>
        <span className="sh-who faint">{item.who}</span>
      </button>
      {open && (
        <div className="sh-body">
          <div className="sh-meta faint">
            {new Date(item.at).toLocaleString("es")} · {item.who} · {resultLabel(item.ok)}
          </div>
          {showDetail && <pre className="sh-pre">{item.detail}</pre>}
          {item.result && <pre className={`sh-pre sh-result${item.ok === false ? " err" : ""}`}>{item.result}</pre>}
          <div className="sh-actions">
            <button className="btn btn-sm" onClick={() => void clipboard.write(item.detail || item.title).then(() => toast.success("Copiado"), (e: unknown) => toast.error("No se pudo copiar", e))}>
              <Copy size={13} /> Copiar {item.source === "audit" || item.source === "vulnscan" ? "resumen" : "comando"}
            </button>
            {onOpenReport && item.source === "audit" && (
              <button className="btn btn-sm" onClick={() => onOpenReport(item)}>
                <ExternalLink size={13} /> Abrir en Administración
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
});
