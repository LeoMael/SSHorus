// «Auditar proyecto» como tarea en segundo plano: audita los servidores del proyecto, como mucho 3 a la vez,
// cada uno como un paso de la tarea. Usa la pestaña abierta de ese servidor o conecta aparte sin diálogos (con
// lo guardado) y cierra esa conexión al terminar. Sudo: el de la pestaña, sin contraseña o la guardada; si
// no hay, audita sin sudo (queda marcado). Un servidor que falla no para a los demás. «Cancelar» no empieza
// más y corta las conexiones propias.
import { errorMessage } from "../../api/core";
import { ssh } from "../../api/ssh";
import { updateJob } from "../../stores/jobs";
import type { JobStep } from "../../stores/jobsState";
import { useProfiles } from "../../stores/profiles";
import { useTabs } from "../../stores/tabs";
import { startJob, type JobCtx } from "../jobs";
import { classifyConnectError } from "../multirun/outcome";
import {
  computeElevation,
  detectPrivilege,
  forgetSudo,
  getPrivilege,
  getSudoPassword,
  obtainSudoPassword,
  sudoPasswordNeeded,
  type Elevation,
} from "../privileges";
import { PROJECT_AUDIT_CONCURRENCY, projectAuditSentence, runPool, type ServerAuditRow } from "./projectAudit";
import { openProjectAudit, patchAuditRow, setProjectJob, useProjectAudit } from "./projectStore";
import { runAudit } from "./run";

export const PROJECTAUDIT_JOB = "projectaudit";

export interface ProjectAuditTarget {
  profileId: string;
  name: string;
}

function tabSession(profileId: string): string | null {
  return useTabs.getState().tabs.find((t) => t.profileId === profileId && t.status === "connected")?.sessionId ?? null;
}

/** La elevación que hay sin preguntar (null = sin sudo). */
async function elevationFor(sessionId: string, profileId: string, reused: boolean): Promise<Elevation | null> {
  const known = reused ? getPrivilege(sessionId) : null;
  const info = known && known.level !== "unknown" ? known : await detectPrivilege(sessionId);
  if (sudoPasswordNeeded(info)) await obtainSudoPassword(sessionId, profileId);
  return computeElevation(info, getSudoPassword(sessionId)).elevation;
}

async function auditServer(ctx: JobCtx, t: ProjectAuditTarget, owned: Set<string>): Promise<void> {
  const set = (p: Partial<ServerAuditRow>) => patchAuditRow(t.profileId, p);
  const profile = useProfiles.getState().getServer(t.profileId);
  if (!profile) return set({ status: "error", step: null, error: "El servidor ya no existe" });
  set({ status: "connecting", step: null, error: null });
  let sessionId = tabSession(t.profileId);
  const reused = sessionId !== null;
  if (!sessionId) {
    try {
      sessionId = (await ssh.connect(t.profileId)).id;
    } catch (e) {
      return set({ status: "error", error: `Sin conexión: ${classifyConnectError(e, profile.auth).message}` });
    }
    owned.add(sessionId);
  }
  try {
    ctx.check();
    set({ status: "auditing", step: "Comprobando sudo…" });
    const elevation = await elevationFor(sessionId, t.profileId, reused);
    const report = await runAudit({ sessionId, profileId: t.profileId, elevation, onStep: (step) => set({ step }) });
    set({ status: "done", step: null, report });
    ctx.output(`${t.name}: ${report.score !== null ? `${report.score}/100 (${report.grade})` : report.summary}${report.elevated ? "" : " · sin sudo"}\n`);
  } catch (e) {
    if (ctx.canceled) set({ status: "canceled", step: null });
    else {
      set({ status: "error", step: null, error: errorMessage(e) });
      ctx.output(`${t.name}: ${errorMessage(e)}\n`);
    }
  } finally {
    if (!reused && owned.delete(sessionId)) {
      // Conexión propia (sin pestaña): su contraseña de sudo en memoria se olvida al cerrarla.
      forgetSudo(sessionId);
      await ssh.disconnect(sessionId).catch(() => undefined);
    }
  }
}

/**
 * Empieza a auditar `targets` (o devuelve la tarea que ya audita ese proyecto). Lo que pasa con cada servidor
 * queda en `useProjectAudit.rows`.
 */
export function startProjectAudit(o: { projectId: string; projectName: string; targets: ProjectAuditTarget[] }): string {
  const running = useProjectAudit.getState().jobs[o.projectId];
  if (running) return running;
  for (const t of o.targets) patchAuditRow(t.profileId, { status: "queued", step: null, error: null });
  const id = startJob({
    kind: PROJECTAUDIT_JOB,
    sessionId: null,
    server: o.projectName,
    title: o.targets.length === 1 ? "Auditar servidor" : "Auditar proyecto",
    detail: o.targets.length === 1 ? o.targets[0].name : `${o.targets.length} servidores`,
    key: `${PROJECTAUDIT_JOB}:${o.projectId}`,
    steps: o.targets.map((t) => t.name),
    watchOutput: false,
    run: async (ctx) => {
      const steps: JobStep[] = o.targets.map((t) => ({ label: t.name, state: "todo" }));
      const mark = (i: number, state: JobStep["state"]) => {
        steps[i] = { ...steps[i], state };
        updateJob(ctx.id, { steps: [...steps] });
      };
      const owned = new Set<string>();
      ctx.onCancel(() => Promise.all([...owned].map((s) => ssh.disconnect(s).catch(() => undefined))));
      let done = 0;
      const total = o.targets.length;
      ctx.progress({ done, total });
      updateJob(ctx.id, { steps: [...steps] });
      await runPool(
        o.targets,
        PROJECT_AUDIT_CONCURRENCY,
        async (t) => {
          const i = o.targets.indexOf(t);
          mark(i, "current");
          await auditServer(ctx, t, owned);
          mark(i, useProjectAudit.getState().rows[t.profileId]?.status === "done" ? "done" : "error");
          ctx.progress({ done: ++done, total });
        },
        () => ctx.canceled,
        (t) => patchAuditRow(t.profileId, { status: "canceled", step: null }),
      );
      const rows = o.targets.map((t) => useProjectAudit.getState().rows[t.profileId]).filter((r): r is ServerAuditRow => !!r);
      const anyDone = rows.some((r) => r.status === "done");
      return {
        status: anyDone || ctx.canceled ? "done" : "failed",
        error: anyDone ? null : "No se pudo auditar ningún servidor",
        summary: projectAuditSentence(rows),
        actions: [{ label: "Ver resumen", primary: true, run: () => openProjectAudit(o.projectId) }],
      };
    },
    onFinished: () => setProjectJob(o.projectId, null),
  });
  setProjectJob(o.projectId, id);
  return id;
}
