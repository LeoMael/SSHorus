// Resultado de «Arreglar» dentro de su tarea en segundo plano (vista grande y diálogo): arreglado /
// siguen, servicios que reiniciar y aviso de reinicio.
import type { Job } from "../../features/jobs";
import type { VulnFixData } from "../../features/vulnscan";
import { FixResult } from "./FixResult";
import "./VulnFix.css";

export function VulnFixJobView({ job }: { job: Job }) {
  const d = job.data as VulnFixData | undefined;
  if (!d?.result || !d.report || !job.sessionId) return null;
  return <FixResult sessionId={job.sessionId} result={d.result} outcomes={d.outcomes ?? null} restart={d.restart} report={d.report} el={d.el} />;
}
