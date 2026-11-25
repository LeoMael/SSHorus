// Contenedores de todos los dueños que se ven: los tuyos y, con sudo, los de root y de cada usuario (como
// el selector «Usuario» de Contenedores). Lo usan el mapa de infraestructura y «Bases de datos».
import type { Elevation } from "../privileges";
import { DETECT_SCRIPT, parseDetect } from "./detect";
import { listContainers } from "./commands";
import { OWNER_SELF, findOwner, ownerKey, ownerOptions, type CtOwner } from "./owner";
import { readOwners, type OwnerRunner } from "./ownerRun";
import { parseContainers } from "./parse";
import { runRaw, scriptFor } from "./run";
import type { Container, Engine } from "./types";

const NONE: Elevation = { kind: "none" };

export interface OwnedContainer extends Container {
  engine: Engine;
  /** Usuario real del contenedor («root» para Docker del sistema). */
  user: string;
}

/** Contenedor con lo necesario para volver a entrar en él como su dueño. */
export interface FoundContainer extends OwnedContainer {
  ctOwner: CtOwner;
  /** Se leyó con la elevación (sudo): hay que usarla también para entrar en él. */
  sudo: boolean;
}

/**
 * Lee los contenedores. `el`: elevación para root y los demás usuarios (null = solo los tuyos, sin sudo).
 * `notes` recibe los errores de tus propios motores (los de otros usuarios se omiten).
 */
export async function readAllContainers(
  sessionId: string,
  el: Elevation | null,
  me: string | null,
  isRootConn: boolean,
  notes: string[],
): Promise<FoundContainer[]> {
  const det = await runRaw(sessionId, DETECT_SCRIPT, NONE, 40);
  const found = det.result ? parseDetect(det.result.stdout) : null;
  if (!found?.ok) return [];
  const isRoot = isRootConn || found.uid === 0;
  const out: FoundContainer[] = [];
  let users: Awaited<ReturnType<typeof import("../vulnscan/run").loadStoreUsers>> | null = null;
  if (el) {
    try {
      const { loadStoreUsers } = await import("../vulnscan/run");
      users = await loadStoreUsers(sessionId, el);
    } catch {
      users = null;
    }
  }
  for (const st of [found.podman, found.docker]) {
    if (!st?.installed) continue;
    if (st.engine === "docker" && found.dockerIsShim) continue;
    const engine = st.engine;
    const owners: CtOwner[] = el ? ownerOptions({ engine, users: users?.users ?? [], me, isRoot }) : [{ kind: "self" }];
    const selfSudo = engine === "docker" && st.needsSudo && !isRoot;
    const usable = owners.filter((o) => o.kind !== "self" || st.accessible || (selfSudo && !!el));
    if (usable.length === 0) continue;
    const userOf = (o: CtOwner) =>
      o.kind === "user" ? o.user.name : o.kind === "root" || isRoot || (engine === "docker" && !st.rootless) ? "root" : (me ?? "");
    const usesSudo = (o: CtOwner) => o.kind !== "self" || selfSudo;
    const runner: OwnerRunner = {
      sessionId,
      engine,
      fallback: OWNER_SELF,
      resolve: (k) => findOwner(owners, k),
      elevationFor: (o) => (usesSudo(o) ? el : NONE),
      label: userOf,
    };
    const per = await readOwners(runner, usable, scriptFor([listContainers(engine)]), 30);
    for (const o of usable) {
      const r = per.get(ownerKey(o));
      if (!r?.ok || !r.result) {
        if (r?.error && o.kind === "self") notes.push(`${engine}: ${r.error.split("\n")[0]}`);
        continue;
      }
      for (const ct of parseContainers(r.result.stdout)) out.push({ ...ct, engine, user: userOf(o), ctOwner: o, sudo: usesSudo(o) });
    }
  }
  return out;
}
