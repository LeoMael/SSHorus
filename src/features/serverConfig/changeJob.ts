// Aplicar un cambio del panel «Configuración» como tarea en segundo plano: como root con la elevación de
// Administración (la contraseña de sudo va por stdin), salida en vivo, «Cancelar» que lo detiene también
// en el servidor y apuntado en el historial de cambios de Administración. Servicios, Paquetes y Tareas
// programadas lanzan sus cambios igual, cada uno con su `kind` y su `area` (el prefijo del historial).
import { errorMessage } from "../../api/core";
import { innerScript, useAdminHistory } from "../admin";
import { JobCanceled, runElevated, startJob, type Job, type JobAction } from "../jobs";
import { ElevationError, failureText, succeeded, type Elevation } from "../privileges";
import type { ConfigChange } from "./model";

export const CONFIG_JOB = "serverconfig";

export interface ConfigJobData {
  changeId: string;
  ok: boolean | null;
  /** sudo pidió (otra vez) la contraseña. */
  needSudo: boolean;
}

export function startConfigChange(o: {
  sessionId: string;
  profileId: string;
  serverName: string;
  elevation: Elevation;
  change: ConfigChange;
  actions?: (d: ConfigJobData) => JobAction[];
  /** Tipo de tarea (por defecto la de «Configuración»): quien la lanza sabe así cuándo volver a leer. */
  kind?: string;
  /** Prefijo en el historial («Configuración», «Servicios»…). */
  area?: string;
}): string {
  const { change: c } = o;
  const action = `${o.area ?? "Configuración"}: ${c.title}`;
  const log = (ok: boolean, result: string) =>
    useAdminHistory.getState().add(o.profileId, { server: o.serverName, action, command: c.steps.join("\n"), ok, result });
  const data: ConfigJobData = { changeId: c.id, ok: null, needSudo: false };
  return startJob({
    kind: o.kind ?? CONFIG_JOB,
    sessionId: o.sessionId,
    server: o.serverName,
    title: c.title,
    detail: c.explain,
    pane: "admin",
    data,
    run: async (ctx) => {
      try {
        const r = await runElevated(ctx, o.sessionId, innerScript({ action, steps: c.steps }), o.elevation, c.timeoutSecs);
        const ok = succeeded(r);
        const text = ok ? r.stdout.trim() || r.stderr.trim() || "Correcto" : failureText(r);
        log(ok, text.slice(-4000));
        const d = { ...data, ok };
        return ok ? { summary: "Hecho", data: d } : { status: "failed", error: text.slice(-600), data: d, actions: o.actions?.(d) ?? [] };
      } catch (e) {
        if (e instanceof JobCanceled) {
          log(false, "Cancelado");
          throw e;
        }
        const msg = errorMessage(e);
        log(false, msg);
        const needSudo = e instanceof ElevationError && (e.failure === "bad-password" || e.failure === "need-password");
        const d = { ...data, ok: false, needSudo };
        return { status: "failed", error: msg, data: d, actions: o.actions?.(d) ?? [] };
      }
    },
  });
}

export function configJobData(job: Job | null | undefined): ConfigJobData | null {
  return job?.kind === CONFIG_JOB ? (job.data as ConfigJobData) : null;
}
