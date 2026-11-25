// Barra «qué se puede hacer»: separa lo que se arregla ya, lo que solo necesita reiniciar, lo que tiene
// arreglo publicado pero aún no está en tus repositorios y lo que aún no tiene arreglo. Cada grupo filtra
// la tabla. «Arreglar todo» y «Volver a comprobar».
import { useMemo } from "react";
import { Box, Clock, Hand, Hourglass, Loader2, RefreshCw, RotateCcw, Square, Wrench, type LucideIcon } from "lucide-react";
import type { Report } from "../../api/vulnscan";
import { canUpgrade, groupFindings, type FixKind } from "../../features/vulnscan";
import { RebootButton } from "../../features/reboot";
import { VulnStaleBanner } from "./VulnStaleBanner";
import "./VulnFix.css";

const CHIPS: { kind: FixKind; label: string; icon: LucideIcon; title: string; always?: boolean }[] = [
  { kind: "now", label: "Se puede arreglar ya", icon: Wrench, title: "Hay versión corregida en la distro", always: true },
  { kind: "reboot", label: "Solo falta reiniciar", icon: RotateCcw, title: "El kernel nuevo ya está instalado" },
  { kind: "norepo", label: "Aún no en tus repos", icon: Hourglass, title: "La versión corregida ya se publicó, pero los repositorios del servidor todavía no la traen: «Arreglar» no la instalaría" },
  { kind: "nofix", label: "Sin arreglo todavía", icon: Clock, title: "Aún no hay versión corregida", always: true },
  { kind: "image", label: "En imágenes", icon: Box, title: "Se arreglan con «Actualizar imagen»" },
  { kind: "manual", label: "A mano", icon: Hand, title: "Programas sueltos: actualízalos desde donde los instalaste" },
];

export function VulnFixBar({
  report,
  sessionId,
  filter,
  onFilter,
  onFixAll,
  checking,
  onRecheck,
  onCancelCheck,
  disabled,
}: {
  report: Report;
  sessionId: string;
  filter: FixKind | null;
  onFilter: (k: FixKind | null) => void;
  onFixAll: () => void;
  /** Texto de progreso de «Volver a comprobar» (null = no está en curso). */
  checking: string | null;
  onRecheck: () => void;
  onCancelCheck: () => void;
  disabled: boolean;
}) {
  const g = useMemo(() => groupFindings(report, report.findings), [report]);
  const reboot = report.host.rebootRequired ?? false;
  return (
    <>
      <div className="vf-bar" role="group" aria-label="Qué se puede hacer">
        {CHIPS.filter((c) => c.always || g[c.kind].length > 0).map(({ kind, label, icon: Icon, title }) => (
          <button
            key={kind}
            className={`vf-chip vf-chip-${kind}${filter === kind ? " on" : ""}`}
            onClick={() => onFilter(filter === kind ? null : kind)}
            aria-pressed={filter === kind}
            title={`${title}. Pulsa para ver solo estas.`}
          >
            <Icon size={12} /> {label}: <strong>{g[kind].length}</strong>
          </button>
        ))}
        <span className="adm-spacer" />
        {g.now.length > 0 && canUpgrade(report) && (
          <button className="btn btn-sm btn-primary" onClick={onFixAll} disabled={disabled || !!checking} title="Actualiza todos esos paquetes con un solo comando. Antes lo muestra y pide confirmación.">
            <Wrench size={13} /> Arreglar todo lo que tiene solución
          </button>
        )}
        {checking ? (
          <>
            <span className="vf-progress" role="status">
              <Loader2 size={13} className="adm-spin" /> {checking}
            </span>
            <button className="btn btn-sm" onClick={onCancelCheck}>
              <Square size={13} /> Cancelar
            </button>
          </>
        ) : (
          <button className="btn btn-sm" onClick={onRecheck} disabled={disabled} title="Vuelve a leer los paquetes del sistema y quita lo que ya está arreglado (las imágenes no se tocan)">
            <RefreshCw size={13} /> Volver a comprobar
          </button>
        )}
      </div>
      <VulnStaleBanner sessionId={sessionId} report={report} disabled={disabled} checking={!!checking} onRecheck={onRecheck} />
      {reboot && !report.host.inContainer && (
        <div className="adm-banner adm-banner-warn vf-reboot" role="status">
          <RotateCcw size={14} />
          <span className="adm-banner-text">
            Reinicia el servidor para terminar de aplicar las actualizaciones
            {report.host.rebootKernel ? ` (kernel ${report.host.rebootKernel})` : ""}.
          </span>
          <RebootButton sessionId={sessionId} onRebooted={onRecheck} />
        </div>
      )}
    </>
  );
}
