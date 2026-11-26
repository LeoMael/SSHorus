// Fase 4 del análisis: contenedores e imágenes. Sin sudo, las del usuario conectado; con sudo, las de
// root y las de los usuarios elegidos (se entra como cada uno desde el script del motor).
import { errorMessage } from "../../api/core";
import { vulnscan, type Engine, type ImageRaw, type ScanNote, type ScanPlan, type UserCtx, type UsersView, type VulnScanSettings } from "../../api/vulnscan";
import { ElevationError } from "../privileges/run";
import type { Elevation } from "../privileges";
import { loadStoreUsers } from "../containers/storeUsers";
import { Canceled, exec, live, markSudoRejected, raw } from "./scanExec";
import { setPhase, setProgress } from "./scanState";
import type { ScanOptions } from "./run";

interface Ctx {
  engine: Engine;
  /** Usuario al que se entra (null = el conectado, o root). */
  user: UserCtx | null;
  /** Etiqueta del dueño para el informe (null = el conectado). */
  owner: string | null;
  el: Elevation;
}

/** Con qué motores y usuarios se miran las imágenes. */
export async function imageContexts(o: ScanOptions, plan: ScanPlan, notes: ScanNote[]): Promise<Ctx[]> {
  const none: Elevation = { kind: "none" };
  // Conectado como root: ya se ve todo sin elevar.
  const el = plan.isRoot ? none : o.elevation && o.elevation.kind !== "none" ? o.elevation : null;
  const own = (): Ctx[] => [
    ...(plan.podman ? [{ engine: "podman" as const, user: null, owner: null, el: none }] : []),
    ...(plan.docker ? [{ engine: "docker" as const, user: null, owner: null, el: none }] : []),
  ];
  // Sin sudo: solo lo del usuario conectado (el motor ya añade el aviso al informe).
  if (!el) return own();
  let users: UsersView;
  try {
    setProgress(o.sessionId, "Buscando usuarios con contenedores…");
    users = await loadStoreUsers(o.sessionId, el);
  } catch (e) {
    if (live.get(o.sessionId)?.canceled) throw new Canceled();
    if (e instanceof ElevationError && e.failure === "bad-password") markSudoRejected(o.sessionId);
    const msg = e instanceof ElevationError ? e.message : errorMessage(e);
    notes.push({ phase: "images", level: "warn", text: `No se pudo usar sudo para ver los contenedores de todos (${msg}); solo los tuyos` });
    return own();
  }
  const chosen = o.settings.usersByServer[o.profileId] ?? [];
  const out: Ctx[] = [];
  if (users.rootPodman) out.push({ engine: "podman", user: null, owner: "root", el });
  if (users.rootDocker) out.push({ engine: "docker", user: null, owner: "root", el });
  for (const u of users.users) {
    if (chosen.length && !chosen.includes(u.name)) continue;
    const ctx: UserCtx = { name: u.name, uid: u.uid, home: u.home };
    if (u.podman) out.push({ engine: "podman", user: ctx, owner: u.name, el });
    if (u.docker) out.push({ engine: "docker", user: ctx, owner: u.name, el });
  }
  return out;
}

export async function scanImages(
  sessionId: string,
  ctxs: Ctx[],
  plan: ScanPlan,
  settings: VulnScanSettings,
  images: ImageRaw[],
  notes: ScanNote[],
): Promise<{ text: string; failed: boolean }> {
  // Primero los listados (para saber cuántas imágenes hay en total).
  const todo: { ctx: Ctx; id: string; tag: string }[] = [];
  let failed = false;
  for (const ctx of ctxs) {
    const who = ctx.owner ?? "tu usuario";
    setProgress(sessionId, `Listando imágenes de ${ctx.engine} (${who})…`);
    try {
      const r = await exec(sessionId, { kind: "images", engine: ctx.engine, user: ctx.user }, ctx.el, 60);
      images.push({ engine: ctx.engine, user: ctx.owner, listing: r.stdout, imageId: "", output: null, error: null });
      const v = await vulnscan.parseImages(ctx.engine, r.stdout, settings.imageLimit);
      if (v.error) failed = true;
      for (const i of v.selected) todo.push({ ctx, id: i.id, tag: i.tags[0] ?? i.id });
    } catch (e) {
      if (e instanceof Canceled) throw e;
      failed = true;
      notes.push({ phase: "images", level: "warn", text: `${ctx.engine} de ${who}: ${errorMessage(e)}` });
    }
  }
  const n = todo.length;
  for (let i = 0; i < n; i++) {
    const { ctx, id, tag } = todo[i];
    const text = `Imagen ${i + 1} de ${n} (${tag})`;
    setPhase(sessionId, "images", "running", text);
    setProgress(sessionId, `${text}…`);
    const trivy = settings.useTrivy && !!plan.trivy && ctx.user === null;
    try {
      const r = await exec(sessionId, { kind: "image", engine: ctx.engine, user: ctx.user, imageId: id, trivy }, ctx.el, trivy ? 180 : 120);
      images.push({ engine: ctx.engine, user: ctx.owner, listing: null, imageId: id, output: raw(r), error: r.timedOut ? "tardó demasiado" : null });
      if (r.timedOut) failed = true;
    } catch (e) {
      if (e instanceof Canceled) throw e;
      failed = true;
      images.push({ engine: ctx.engine, user: ctx.owner, listing: null, imageId: id, output: null, error: errorMessage(e) });
    }
  }
  return { text: n === 0 ? "No hay imágenes que analizar" : `${n} ${n === 1 ? "imagen" : "imágenes"}`, failed };
}
