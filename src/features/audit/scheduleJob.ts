// La tanda de la auditoría programada como tarea en segundo plano: lee el último informe de cada servidor,
// lo audita como «Auditar proyecto» (como mucho 3 a la vez, sin diálogos, con lo guardado, y cierra la conexión
// propia al terminar) y lo compara con el anterior. Sin aviso «terminó» en la esquina: quien la lanza
// (scheduler.ts) solo avisa si algo empeoró o no se pudo. Se carga aparte (import()) para no entrar al arrancar.
import { audit, type AuditReport } from "../../api/audit";
import { ssh } from "../../api/ssh";
import { dropJobNotice, updateJob } from "../../stores/jobs";
import type { JobStep } from "../../stores/jobsState";
import { startJob } from "../jobs";
import { useLock } from "../lock/lockStore";
import { auditDiff } from "./auditDiff";
import { PROJECT_AUDIT_CONCURRENCY, runPool } from "./projectAudit";
import { auditServer, type ProjectAuditTarget } from "./projectAuditJob";
import { patchAuditRow, useProjectAudit } from "./projectStore";
import { CANCELED, SCHEDULED_AUDIT_JOB, worsenedChanges, type ServerOutcome } from "./schedule";
import { openAuditChanges } from "./scheduleStore";

/** Audita `targets` y llama a `onDone` con cómo fue cada uno (también si se cancela). */
export function startScheduledAudit(targets: ProjectAuditTarget[], onDone: (outcomes: ServerOutcome[]) => void): string {
  const outcomes: ServerOutcome[] = [];
  for (const t of targets) patchAuditRow(t.profileId, { status: "queued", step: null, error: null });
  return startJob({
    kind: SCHEDULED_AUDIT_JOB,
    sessionId: null,
    server: targets.length === 1 ? targets[0].name : "",
    title: "Auditoría programada",
    detail: targets.length === 1 ? targets[0].name : `${targets.length} servidores`,
    key: SCHEDULED_AUDIT_JOB,
    steps: targets.map((t) => t.name),
    watchOutput: false,
    run: async (ctx) => {
      const steps: JobStep[] = targets.map((t) => ({ label: t.name, state: "todo" }));
      const mark = (i: number, state: JobStep["state"]) => {
        steps[i] = { ...steps[i], state };
        updateJob(ctx.id, { steps: [...steps] });
      };
      const owned = new Set<string>();
      ctx.onCancel(() => Promise.all([...owned].map((s) => ssh.disconnect(s).catch(() => undefined))));
      let done = 0;
      ctx.progress({ done, total: targets.length });
      await runPool(
        targets,
        PROJECT_AUDIT_CONCURRENCY,
        async (t) => {
          const i = targets.indexOf(t);
          mark(i, "current");
          const prev: AuditReport | null = await audit.latest(t.profileId).catch(() => null);
          await auditServer(ctx, t, owned);
          const row = useProjectAudit.getState().rows[t.profileId];
          const ok = row?.status === "done" && !!row.report;
          outcomes.push({
            profileId: t.profileId,
            name: t.name,
            error: ok ? null : (row?.error ?? CANCELED),
            diff: ok && row.report ? auditDiff(row.report, prev) : null,
          });
          mark(i, ok ? "done" : "error");
          ctx.progress({ done: ++done, total: targets.length });
        },
        // Si SSHorus se bloquea a mitad, no se abren más servidores (sin lo guardado se auditarían peor).
        () => ctx.canceled || !!useLock.getState().status?.locked,
        (t) => {
          patchAuditRow(t.profileId, { status: "canceled", step: null });
          outcomes.push({ profileId: t.profileId, name: t.name, error: CANCELED, diff: null });
        },
      );
      const audited = outcomes.filter((o) => !o.error).length;
      const worse = worsenedChanges(outcomes);
      const parts = [`${audited} de ${targets.length} auditados`, worse.length ? `empeoró en ${worse.map((w) => w.name).join(", ")}` : "nada empeoró"];
      return {
        status: audited || ctx.canceled ? "done" : "failed",
        error: audited ? null : "No se pudo auditar ningún servidor",
        summary: parts.join(" · "),
        actions: worse.length ? [{ label: "Ver qué cambió", primary: true, run: () => openAuditChanges(worse) }] : [],
      };
    },
    onFinished: (job) => {
      dropJobNotice(job.id);
      onDone(outcomes);
    },
  });
}
