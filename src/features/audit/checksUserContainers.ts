// Comprobaciones de los contenedores sin root (Podman) de cada usuario: --privileged, montajes peligrosos,
// puertos en todas las interfaces, imágenes «latest» o viejas, root dentro, sin límite de memoria y sin linger.
// Funciones puras. Los arreglos que se pueden aplicar se ejecutan como root, entrando como el dueño
// (`ownerLine`, igual que Contenedores). `detail` no lleva nombres de usuario (va a la IA): van en `items`.
import type { Check, Fix } from "../../api/audit";
import { ownerLine, q, type Cmd } from "../containers";
import { NEEDS_SUDO, check, fix, plural } from "./checksCommon";
import type { UserContainer, UserContainersRead } from "./userContainers";

/** Una imagen se considera sin actualizar a partir de estos días. */
export const OLD_IMAGE_DAYS = 180;
/** Límite que pone el arreglo «sin límite de memoria». */
export const MEMORY_FIX = "1g";

const DAY = 86_400_000;
/** Nombre de contenedor aceptado para escribir un arreglo (las reglas de Podman). */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const DANGER_DIRS = new Set(["/", "/etc", "/root", "/boot", "/usr", "/var", "/home", "/proc", "/sys", "/dev"]);
const SOCKET_RE = /(^|\/)(docker|podman|containerd)\.sock$/;

const label = (c: UserContainer) => `${c.owner}/${c.name}`;

/** Montajes que dan acceso a carpetas del sistema o al socket de un motor de contenedores. */
export function dangerousMounts(c: UserContainer): string[] {
  return c.mounts.filter((m) => DANGER_DIRS.has(m.source.replace(/\/+$/, "") || "/") || SOCKET_RE.test(m.source)).map((m) => `${m.source} → ${m.dest}`);
}

/** Puertos publicados en todas las interfaces (menos la web, 80 y 443, que suelen ir así). */
export function openPorts(c: UserContainer): string[] {
  return c.ports.filter((b) => {
    const m = /^(.*):(\d+)->/.exec(b);
    if (!m) return false;
    const port = Number(m[2]);
    return (m[1] === "" || m[1] === "0.0.0.0" || m[1] === "::" || m[1] === "[::]") && port !== 80 && port !== 443;
  });
}

/** La imagen no tiene versión fija («latest» o sin etiqueta). */
export function floatingTag(image: string): boolean {
  if (!image || image.includes("@sha256:")) return false;
  const last = image.slice(image.lastIndexOf("/") + 1);
  return !last.includes(":") || last.endsWith(":latest");
}

export function runsAsRoot(user: string): boolean {
  return user === "" || user === "root" || user === "0" || /^(0|root):/.test(user);
}

/** Una comprobación con su versión «bien» y su versión con problemas. */
function rule(
  id: string,
  title: string,
  bad: string[],
  o: { status: "bad" | "warn"; weight: number; okText: string; badText: (n: number) => string; fix?: Fix | null },
): Check {
  if (bad.length === 0) return check(id, "containers", title, "ok", o.okText, { weight: o.weight });
  return check(id, "containers", title, o.status, o.badText(bad.length), { weight: o.weight, items: bad, fix: o.fix ?? null });
}

/** El comando ya como el dueño (se ejecuta como root). */
function asOwner(read: UserContainersRead, owner: string, cmd: Cmd): string | null {
  const user = read.users.find((u) => u.name === owner);
  return user ? ownerLine(cmd, { kind: "user", user }, { engine: "podman", elevPrefix: "", selfPrefix: "", runuser: read.runuser }) : null;
}

function memoryFix(read: UserContainersRead, list: UserContainer[]): Fix | null {
  const lines = list
    .filter((c) => NAME_RE.test(c.name))
    .map((c) => asOwner(read, c.owner, { bin: ["podman"], args: ["update", "--memory", MEMORY_FIX, c.name] }))
    .filter((l): l is string => !!l);
  if (lines.length === 0) return null;
  return fix(lines.join("\n"), {
    danger: true,
    note: `Pone ${MEMORY_FIX} a cada uno (Podman 4.3 o más nuevo). Si alguno necesita más, se cerrará: ajústalo en su compose o al crearlo. Al volver a crearlo se pierde.`,
  });
}

/** Usuarios con contenedores en marcha que se pararán al cerrar su sesión (sin linger). */
function lingerCheck(read: UserContainersRead, owners: string[]): Check | null {
  const known = read.users.filter((u) => owners.includes(u.name) && u.linger !== null && u.linger !== undefined);
  if (known.length === 0) return null;
  const off = known.filter((u) => u.linger === false).map((u) => u.name);
  return rule("ctr.users.linger", "Contenedores que se paran al cerrar la sesión", off, {
    status: "warn",
    weight: 1,
    okText: "Sus dueños tienen linger: siguen en marcha sin sesión abierta",
    badText: (n) => `${plural(n, "usuario no tiene", "usuarios no tienen")} linger: sus contenedores se paran al cerrar su sesión`,
    fix: fix(off.map((u) => `loginctl enable-linger ${q(u)}`).join("\n")),
  });
}

/**
 * Comprobaciones de los contenedores de los usuarios. `read` null = no se pudo leer (hace falta sudo).
 * `now` en ms (para la edad de las imágenes).
 */
export function userContainerChecks(read: UserContainersRead | null, now: number): Check[] {
  const T = "Contenedores de los usuarios";
  if (!read) return [check("ctr.users", "containers", T, "skip", NEEDS_SUDO)];
  const errs = read.errors.map((e) => `No se pudo leer ${e}`);
  const cs = read.containers;
  if (cs.length === 0) {
    const status = errs.length ? "skip" : "info";
    const detail = errs.length ? "No se pudieron leer los contenedores de los usuarios" : "Ningún usuario tiene contenedores sin root en marcha";
    return [check("ctr.users", "containers", T, status, detail, { items: errs })];
  }
  const owners = [...new Set(cs.map((c) => c.owner))];
  const old = cs.filter((c) => c.imageCreated !== null && now - c.imageCreated > OLD_IMAGE_DAYS * DAY);
  const noMem = cs.filter((c) => c.memory === 0);
  const out: Check[] = [
    check("ctr.users", "containers", T, "info", `${plural(cs.length, "contenedor sin root", "contenedores sin root")} de ${plural(owners.length, "usuario", "usuarios")}`, {
      items: [...cs.map(label), ...errs],
    }),
    rule("ctr.users.privileged", "Contenedores de usuarios con --privileged", cs.filter((c) => c.privileged).map(label), {
      status: "bad",
      weight: 2,
      okText: "Ninguno tiene --privileged",
      badText: (n) => `${plural(n, "contenedor tiene", "contenedores tienen")} todos los permisos de su usuario y sus dispositivos`,
      fix: fix("# Vuelve a crear el contenedor sin --privileged (o solo con los --cap-add que necesite)", { manual: true }),
    }),
    rule("ctr.users.mounts", "Montajes peligrosos", cs.flatMap((c) => dangerousMounts(c).map((m) => `${label(c)}: ${m}`)), {
      status: "bad",
      weight: 2,
      okText: "Ninguno monta carpetas del sistema ni el socket de Docker o Podman",
      badText: (n) => `${plural(n, "montaje da", "montajes dan")} acceso a carpetas del sistema o al socket de un motor`,
      fix: fix("# Monta solo la carpeta que necesita (no /, /etc ni el socket de Docker o Podman)", { manual: true }),
    }),
    rule("ctr.users.ports", "Puertos de contenedores de usuarios expuestos", cs.flatMap((c) => openPorts(c).map((p) => `${label(c)}: ${p}`)), {
      status: "warn",
      weight: 1,
      okText: "Solo publican la web o en 127.0.0.1",
      badText: (n) => `${plural(n, "puerto publicado", "puertos publicados")} en todas las interfaces`,
      fix: fix("# Publica con -p 127.0.0.1:PUERTO:PUERTO y pon delante el proxy web", { manual: true }),
    }),
    rule("ctr.users.latest", "Imágenes sin versión fija", cs.filter((c) => floatingTag(c.image)).map((c) => `${label(c)}: ${c.image}`), {
      status: "warn",
      weight: 1,
      okText: "Todas usan una versión fija",
      badText: (n) => `${plural(n, "contenedor usa", "contenedores usan")} «latest» o una imagen sin etiqueta`,
      fix: fix("# Usa una versión concreta (p. ej. nginx:1.27) al crear el contenedor", { manual: true }),
    }),
    rule("ctr.users.old", "Imágenes sin actualizar", old.map((c) => `${label(c)}: ${c.image} (${Math.floor((now - (c.imageCreated ?? now)) / DAY)} días)`), {
      status: "warn",
      weight: 1,
      okText: `Ninguna imagen tiene más de ${OLD_IMAGE_DAYS} días`,
      badText: (n) => `${plural(n, "contenedor usa", "contenedores usan")} una imagen de hace más de ${OLD_IMAGE_DAYS} días`,
      fix: fix("# Actualiza la imagen (Contenedores → Imágenes → Actualizar) y vuelve a crear el contenedor", { manual: true }),
    }),
    rule("ctr.users.root", "Contenedores de usuarios como root dentro", cs.filter((c) => runsAsRoot(c.user)).map(label), {
      status: "warn",
      weight: 1,
      okText: "Todos corren con un usuario sin privilegios dentro",
      badText: (n) => `${plural(n, "contenedor corre", "contenedores corren")} como root dentro (fuera es su usuario)`,
      fix: fix("# Crea el contenedor con --user 1000:1000 (o el usuario de la imagen) si la aplicación lo permite", { manual: true }),
    }),
    rule("ctr.users.memory", "Contenedores sin límite de memoria", noMem.map(label), {
      status: "warn",
      weight: 1,
      okText: "Todos tienen límite de memoria",
      badText: (n) => `${plural(n, "contenedor puede", "contenedores pueden")} usar toda la memoria del servidor`,
      fix: memoryFix(read, noMem),
    }),
  ];
  const linger = lingerCheck(read, owners);
  if (linger) out.push(linger);
  return out;
}
