// Contenedores sin root (Podman) de cada usuario del servidor, para la auditoría: se leen con sudo entrando
// como su dueño (igual que Contenedores con «Todos»: su HOME y su XDG_RUNTIME_DIR, o `/tmp/sshorus-run-<uid>`
// si no tiene sesión). Solo lee. El parseo es puro y se prueba en userContainers.test.ts.
import { errorMessage } from "../../api/core";
import type { StoreUser } from "../../api/vulnscan";
import { PATH_PREFIX, loadStoreUsers, ownerKey, readOwners, runRaw, validOwnerUser, type CtOwner, type OwnerRunner } from "../containers";
import type { Elevation } from "../privileges";

/** Un contenedor en marcha de un usuario. */
export interface UserContainer {
  /** Usuario dueño. */
  owner: string;
  name: string;
  privileged: boolean;
  /** `--user` del contenedor ("" = el de la imagen, casi siempre root). */
  user: string;
  /** Límite de memoria en bytes (0 = sin límite). */
  memory: number;
  image: string;
  imageId: string;
  /** Fecha de la imagen (ms) o null si no se supo. */
  imageCreated: number | null;
  /** «ip:puerto->puertoInterno/proto». */
  ports: string[];
  mounts: { dest: string; source: string }[];
}

/** Lo leído: los usuarios con Podman propio, sus contenedores y los que no se pudieron leer. */
export interface UserContainersRead {
  users: StoreUser[];
  containers: UserContainer[];
  /** «usuario: motivo». */
  errors: string[];
  /** El servidor tiene `runuser` (para escribir los arreglos como el dueño). */
  runuser: boolean;
}

/**
 * Script que corre YA como el usuario. Una línea `C|…` por contenedor (los puertos al final), una `M|destino|origen`
 * por montaje (el origen al final: puede llevar «|») y una `I|id|fecha` por imagen.
 */
export const USER_CONTAINERS_SCRIPT = [
  PATH_PREFIX,
  "command -v podman >/dev/null 2>&1 || exit 0",
  "ids=$(podman ps -q) || exit 3",
  '[ -n "$ids" ] || exit 0',
  "podman inspect --format 'C|{{.Name}}|{{.HostConfig.Privileged}}|{{.Config.User}}|{{.HostConfig.Memory}}|{{.ImageName}}|{{.Image}}|" +
    "{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostIp}}:{{.HostPort}}->{{$p}} {{end}}{{end}}{{println}}" +
    "{{range .Mounts}}M|{{.Destination}}|{{.Source}}{{println}}{{end}}' $ids",
  "imgs=$(podman inspect --format '{{.Image}}' $ids | sort -u)",
  "[ -z \"$imgs\" ] || podman image inspect --format 'I|{{.Id}}|{{.Created.Unix}}' $imgs 2>/dev/null",
  "true",
].join("\n");

/** Contenedor «infra» de un pod (la imagen pause): no se audita. */
function isInfra(name: string, image: string): boolean {
  return /-infra$/.test(name) || /(^|\/)(podman-)?pause(:|@|$)/.test(image);
}

/** Lee la salida de USER_CONTAINERS_SCRIPT de un usuario. */
export function parseUserContainers(owner: string, stdout: string): UserContainer[] {
  const out: UserContainer[] = [];
  const created = new Map<string, number>();
  let cur: UserContainer | null = null;
  for (const line of stdout.split("\n")) {
    const p = line.split("|");
    if (p[0] === "C" && p.length >= 8) {
      const mem = Number(p[4]);
      cur = {
        owner,
        name: p[1].replace(/^\//, ""),
        privileged: p[2] === "true",
        user: p[3].trim(),
        memory: Number.isFinite(mem) && mem > 0 ? mem : 0,
        image: p[5].trim(),
        imageId: p[6].trim().replace(/^sha256:/, ""),
        imageCreated: null,
        ports: p.slice(7).join("|").trim().split(/\s+/).filter(Boolean),
        mounts: [],
      };
      if (isInfra(cur.name, cur.image)) cur = null;
      else out.push(cur);
    } else if (p[0] === "M" && p.length >= 3 && cur) {
      cur.mounts.push({ dest: p[1], source: p.slice(2).join("|") });
    } else if (p[0] === "I" && p.length === 3 && /^\d+$/.test(p[2])) {
      created.set(p[1].replace(/^sha256:/, ""), Number(p[2]) * 1000);
    }
  }
  for (const c of out) {
    const t = created.get(c.imageId);
    // Fechas absurdas (imágenes reproducibles con fecha 0) no cuentan.
    c.imageCreated = t !== undefined && t > Date.UTC(2000, 0, 1) ? t : null;
  }
  return out;
}

/** El primer renglón útil de un error, corto. */
function firstLine(s: string | null | undefined): string {
  return (s ?? "").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 160) ?? "sin respuesta";
}

/**
 * Lee los contenedores de todos los usuarios con Podman propio (menos root, que ya sale en la auditoría). Necesita
 * root o sudo (`el`). Nunca lanza: lo que falla va a `errors`.
 */
export async function readUserContainers(sessionId: string, el: Elevation): Promise<UserContainersRead> {
  const empty: UserContainersRead = { users: [], containers: [], errors: [], runuser: false };
  let users: StoreUser[];
  let runuser: boolean;
  try {
    const [view, ru] = await Promise.all([
      loadStoreUsers(sessionId, el),
      runRaw(sessionId, "if command -v runuser >/dev/null 2>&1; then echo runuser=1; fi", el, 15),
    ]);
    users = view.users.filter((u) => u.podman && u.name !== "root" && validOwnerUser(u));
    runuser = !!ru.result?.stdout.includes("runuser=1");
  } catch (e) {
    return { ...empty, errors: [`No se pudo leer la lista de usuarios: ${firstLine(errorMessage(e))}`] };
  }
  if (users.length === 0) return { ...empty, runuser };
  const owners: CtOwner[] = users.map((user) => ({ kind: "user", user }));
  const runner: OwnerRunner = {
    sessionId,
    engine: "podman",
    fallback: "self",
    resolve: () => null,
    elevationFor: () => el,
    label: (o) => (o.kind === "user" ? o.user.name : o.kind),
  };
  const per = await readOwners(runner, owners, USER_CONTAINERS_SCRIPT, 40);
  const containers: UserContainer[] = [];
  const errors: string[] = [];
  for (const u of users) {
    const r = per.get(ownerKey({ kind: "user", user: u }));
    if (r?.ok && r.result) containers.push(...parseUserContainers(u.name, r.result.stdout));
    else errors.push(`${u.name}: ${firstLine(r?.error ?? r?.result?.stderr)}`);
  }
  return { users, containers, errors, runuser };
}
