// Barra de «Vulnerabilidades»: Analizar/Cancelar, fuentes usadas, usuarios, IA, exportar, historial y
// opciones; debajo, qué se envía a OSV.dev.
import { Bot, Check, CircleSlash, Eye, FileDown, History, Play, Settings2, Square, Users } from "lucide-react";
import type { Report } from "../../../api/vulnscan";
import { cancelScan } from "../../../features/vulnscan";
import { useSettings } from "../../../stores/settings";
import { useAdmin } from "../context";
import { useAiBlock } from "./useAiBlock";

export type VulnsDialog = "osv" | "history" | "export" | "users" | "options" | "ai";

export function VulnsToolbar({
  report,
  running,
  checking,
  onAnalyze,
  onOpenUsers,
  onDialog,
}: {
  report: Report | null | undefined;
  running: boolean;
  /** Se está volviendo a comprobar un arreglo: no se puede analizar a la vez. */
  checking: boolean;
  onAnalyze: () => void;
  onOpenUsers: () => void;
  onDialog: (d: VulnsDialog) => void;
}) {
  const { sessionId, profileId, disabled, elevation } = useAdmin();
  const vs = useSettings((s) => s.settings.vulnscan);
  const aiEnabled = useSettings((s) => s.settings.ai.enabled);
  const aiBlock = useAiBlock(report);
  const chosen = vs.usersByServer[profileId] ?? [];
  const sources = report?.sources?.length
    ? report.sources
    : [
        { id: "osv" as const, label: "OSV.dev", used: vs.useOsv, note: vs.useOsv ? null : "desactivado" },
        { id: "distro" as const, label: "Distro", used: vs.useDistroTool, note: null },
        { id: "trivy" as const, label: "Trivy", used: false, note: "se sabrá al analizar" },
      ];

  return (
    <>
      <div className="adm-toolbar">
        {running ? (
          <button className="btn btn-sm" onClick={() => void cancelScan(sessionId)}>
            <Square size={13} /> Cancelar
          </button>
        ) : (
          <button
            className="btn btn-sm btn-primary"
            onClick={onAnalyze}
            disabled={disabled || checking}
            title={disabled ? "Sin conexión con el servidor" : "Analiza el servidor (solo lectura)"}
          >
            <Play size={13} /> Analizar
          </button>
        )}
        <span className="vs-sources" aria-label="Fuentes">
          {sources.map((s) => (
            <span key={s.id} className={`vs-src${s.used ? " on" : ""}`} title={`${s.label}${s.note ? `: ${s.note}` : s.used ? ": usado" : ""}`}>
              {s.used ? <Check size={11} /> : <CircleSlash size={11} />} {s.id === "osv" ? "OSV" : s.id === "trivy" ? s.label : "Distro"}
            </span>
          ))}
        </span>
        {elevation && (
          <button className="btn btn-sm" onClick={onOpenUsers} disabled={running || disabled} title="De qué usuarios se miran los contenedores">
            <Users size={13} /> Usuarios: {chosen.length ? chosen.length : "Todos"}
          </button>
        )}
        <span className="adm-spacer" />
        {aiEnabled && (
          <button className="btn btn-sm" onClick={() => onDialog("ai")} disabled={!!aiBlock || running} title={aiBlock ?? "Pide a la IA que explique este informe"}>
            <Bot size={13} /> Explicar con IA
          </button>
        )}
        <button className="btn btn-sm" onClick={() => onDialog("export")} disabled={!report} title="Exportar a JSON o Markdown">
          <FileDown size={13} /> Exportar
        </button>
        <button className="icon-btn" onClick={() => onDialog("history")} title="Historial de análisis" aria-label="Historial de análisis">
          <History size={14} />
        </button>
        <button className="icon-btn" onClick={() => onDialog("options")} title="Opciones del análisis" aria-label="Opciones del análisis">
          <Settings2 size={14} />
        </button>
      </div>
      <div className="vs-privacy">
        A OSV.dev solo se envían nombres y versiones de paquetes. Nunca la IP ni el nombre del servidor.{" "}
        <button className="vs-link" onClick={() => onDialog("osv")}>
          <Eye size={11} /> ver qué se envía
        </button>
      </div>
    </>
  );
}
