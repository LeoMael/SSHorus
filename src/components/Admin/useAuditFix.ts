// Estado de «Arreglar» en la auditoría (uno o varios): los arreglos van como tarea en segundo plano
// (features/audit/fixJob.ts) y el diálogo solo la sigue; si se cierra, la tarea sigue en la esquina.
import { useState } from "react";
import type { AuditReport, Check } from "../../api/audit";
import { auditFixData, startAuditFix } from "../../features/audit";
import { useJobs } from "../../stores/jobs";
import { useAdmin } from "./context";

export type FixPhase = "idle" | "running" | "done";

export function useAuditFix() {
  const { sessionId, profileId, serverName, elevation, askSudo } = useAdmin();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobs((s) => (jobId ? (s.jobs.find((j) => j.id === jobId) ?? null) : null));
  const phase: FixPhase = !job ? "idle" : job.status === "running" ? "running" : "done";
  const data = auditFixData(job);

  const start = (report: AuditReport, checks: Check[]) => {
    if (!elevation || phase === "running") return;
    setJobId(
      startAuditFix({
        sessionId,
        profileId,
        serverName,
        elevation,
        report,
        checks,
        actions: (d) => (d.needSudo ? [{ label: "Introducir contraseña de sudo", run: askSudo }] : []),
      }),
    );
  };

  return { phase, job, results: data.results, outcomes: data.outcomes, recheckError: data.recheckError, start };
}
