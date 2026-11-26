// Cortafuegos: aplicar un cambio como tarea en segundo plano (centro de tareas). Si el cambio va «a
// prueba», queda pendiente de confirmar: «Hacer permanente» / «Mantener» o «Deshacer ahora»; si nadie
// responde, el servidor lo deshace solo. Si toca el acceso, se prueba antes una conexión SSH nueva.
import { create } from "zustand";
import { isApiError } from "../../../api/core";
import { newExecId } from "../../../api/snippets";
import { ssh } from "../../../api/ssh";
import { useProfiles } from "../../../stores/profiles";
import { runElevated, startJob, type JobAction, type JobCtx, type JobResult } from "../../jobs";
import { computeElevation, failureText, getPrivilege, getSudoPassword, succeeded, type Elevation } from "../../privileges";
import { confirmScript, directScript, trialScript, TRIAL_SECS, undoScript, type FwPlan } from "./commands";
import { loginCheck, type LoginCheck } from "./lockout";

export const FIREWALL_JOB = "firewall";

export interface FwTrial {
  tag: string;
  sessionId: string;
  serverName: string;
  plan: FwPlan;
  /** Momento en que el servidor lo deshace solo. */
  until: number;
}

/** Cambios aplicados a prueba que esperan confirmación, por sesión. */
export const useFwTrials = create<{ trials: FwTrial[] }>(() => ({ trials: [] }));

function dropTrial(tag: string) {
  useFwTrials.setState((s) => ({ trials: s.trials.filter((t) => t.tag !== tag) }));
}

export interface FwChangeRequest {
  sessionId: string;
  profileId: string;
  serverName: string;
  elevation: Elevation;
  plan: FwPlan;
}

/** ¿Se puede abrir una conexión SSH nueva al servidor? (con la contraseña o llave guardadas). */
async function probeLogin(profileId: string): Promise<LoginCheck> {
  const profile = useProfiles.getState().servers.find((s) => s.id === profileId);
  if (!profile) return "unclear";
  try {
    await ssh.testConnection(newExecId(), profile, { useSavedSecret: true });
    return "ok";
  } catch (e) {
    return loginCheck(isApiError(e) ? e.kind : "Unknown");
  }
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

/** Botones para resolver un cambio a prueba (en el aviso de la tarea y en el panel del mapa). */
export function trialActions(t: FwTrial): JobAction[] {
  return [
    { label: t.plan.tool === "firewalld" ? "Hacer permanente" : "Mantener", primary: true, run: () => finishTrial(t, "confirm") },
    { label: "Deshacer ahora", run: () => finishTrial(t, "undo") },
  ];
}

async function run(ctx: JobCtx, req: FwChangeRequest): Promise<JobResult> {
  const { plan } = req;
  const tag = ctx.id;
  ctx.output(plan.apply.map((c) => `$ ${c}\n`).join(""));
  // El servidor cuenta el tiempo desde que se arma la vuelta atrás (antes de aplicar y de probar a entrar).
  const armedAt = Date.now();
  const r = await runElevated(ctx, req.sessionId, plan.trial ? trialScript(plan, tag) : directScript(plan), req.elevation, 60);
  if (!succeeded(r)) return { status: "failed", error: failureText(r) };
  if (plan.checkLogin) {
    ctx.step(1);
    ctx.phase("Probando a entrar con una conexión SSH nueva…");
    const login = await probeLogin(req.profileId);
    if (login === "blocked") {
      ctx.output("La conexión nueva no pasó: se deshace el cambio.\n");
      const u = await runElevated(ctx, req.sessionId, undoScript(plan, tag), req.elevation, 60);
      if (!succeeded(u)) {
        const at = clock(armedAt + TRIAL_SECS * 1000);
        return { status: "failed", error: `Con este cambio no se podía entrar por SSH y no se pudo deshacer ahora (${failureText(u)}): el servidor lo deshace solo a las ${at}.` };
      }
      return { status: "failed", error: "Con este cambio no se podía entrar por SSH: se deshizo." };
    }
    ctx.output(login === "ok" ? "Se puede entrar por SSH: bien.\n" : "No se pudo comprobar si se puede entrar: pruébalo tú con otra pestaña antes de confirmar.\n");
  }
  if (!plan.trial) return { summary: "Hecho." };
  const trial: FwTrial = { tag, sessionId: req.sessionId, serverName: req.serverName, plan, until: armedAt + TRIAL_SECS * 1000 };
  useFwTrials.setState((s) => ({ trials: [...s.trials, trial] }));
  ctx.step(plan.checkLogin ? 2 : 1);
  return { summary: `Aplicado a prueba: si no lo confirmas, se deshace solo a las ${clock(trial.until)}.`, actions: trialActions(trial) };
}

/** Aplica el cambio y devuelve el id de la tarea. */
export function startFirewallChange(req: FwChangeRequest): string {
  const steps = ["Aplicar el cambio", ...(req.plan.checkLogin ? ["Probar una conexión nueva"] : []), ...(req.plan.trial ? ["Esperar tu confirmación"] : [])];
  return startJob({
    kind: FIREWALL_JOB,
    sessionId: req.sessionId,
    server: req.serverName,
    title: `Cortafuegos: ${req.plan.title}`,
    detail: req.plan.apply.join(" · "),
    steps,
    cancelLabel: null,
    run: (ctx) => run(ctx, req),
  });
}

/** «Hacer permanente» / «Mantener» o «Deshacer ahora» de un cambio a prueba. */
export function finishTrial(t: FwTrial, what: "confirm" | "undo"): string | null {
  if (!useFwTrials.getState().trials.some((x) => x.tag === t.tag)) return null;
  dropTrial(t.tag);
  return startJob({
    kind: FIREWALL_JOB,
    sessionId: t.sessionId,
    server: t.serverName,
    title: `Cortafuegos: ${what === "confirm" ? "confirmar" : "deshacer"} · ${t.plan.title}`,
    detail: (what === "confirm" ? t.plan.permanent : t.plan.revert).join(" · "),
    cancelLabel: null,
    run: async (ctx) => {
      const el = computeElevation(getPrivilege(t.sessionId), getSudoPassword(t.sessionId)).elevation;
      if (!el) {
        useFwTrials.setState((s) => ({ trials: [...s.trials, t] }));
        return { status: "failed", error: "Hace falta sudo para terminar el cambio. Si no lo confirmas, se deshace solo.", actions: trialActions(t) };
      }
      const r = await runElevated(ctx, t.sessionId, what === "confirm" ? confirmScript(t.plan, t.tag) : undoScript(t.plan, t.tag), el, 60);
      if (!succeeded(r)) {
        // Sigue a prueba (salvo si ya se deshizo solo, código 3): se puede volver a intentar.
        if (r.exitCode !== 3 && Date.now() < t.until) {
          useFwTrials.setState((s) => ({ trials: [...s.trials, t] }));
          return { status: "failed", error: failureText(r), actions: trialActions(t) };
        }
        return { status: "failed", error: failureText(r) };
      }
      return { summary: what === "confirm" ? (t.plan.permanent.length ? "Guardado: el cambio queda fijo." : "Hecho: el cambio se queda.") : "Deshecho." };
    },
  });
}

/** Quita de la lista los cambios a prueba que el servidor ya deshizo solo. */
export function expireTrials(now = Date.now()): void {
  const s = useFwTrials.getState().trials;
  if (s.some((t) => t.until <= now)) useFwTrials.setState({ trials: s.filter((t) => t.until > now) });
}
