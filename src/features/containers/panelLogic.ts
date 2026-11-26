// Panel de Contenedores (funciones puras): sub-pestañas, qué motor usar, qué cargar, nombres de dueños
// y textos que dependen del estado. Solo importa módulos sin efectos (se prueban con node).
import { OWNER_SELF, type CtOwner } from "./owner";
import type { Cmd } from "./shell";
import type { EngineStatus } from "./detect";
import type { Container, Engine } from "./types";
import type { Elevation } from "../privileges";

/** Listas que carga el panel (cada una con su estado de carga). */
export type ResourceKind = "containers" | "images" | "volumes" | "networks" | "df";

export type SubTab = "containers" | "images" | "volumes" | "networks" | "compose" | "cleanup";

export const SUBTABS: { id: SubTab; label: string }[] = [
  { id: "containers", label: "Contenedores" },
  { id: "images", label: "Imágenes" },
  { id: "volumes", label: "Volúmenes" },
  { id: "networks", label: "Redes" },
  { id: "compose", label: "Compose" },
  { id: "cleanup", label: "Limpieza" },
];

export const NO_ELEVATION: Elevation = { kind: "none" };

/** Recursos que necesita la sub-pestaña. */
export function neededResources(tab: SubTab, all: boolean): ResourceKind[] {
  switch (tab) {
    case "containers":
    case "compose":
      return ["containers"];
    case "images":
      return ["images", "containers"];
    case "volumes":
      return ["volumes"];
    case "networks":
      return ["networks", "containers"];
    case "cleanup":
      // Con «Todos» la limpieza pide elegir un usuario: no hace falta calcular el espacio.
      return all ? [] : ["df", "containers", "images", "volumes"];
  }
}

/** Motor que se usa: el elegido; si no, el que funcione sin sudo; si no, el primero. */
export function pickStatus(available: EngineStatus[], pref: Engine | null): EngineStatus | null {
  return available.find((s) => s.engine === pref) ?? available.find((s) => s.accessible) ?? available[0] ?? null;
}

/** Dueños (clave) con contenedores en marcha, ordenados y unidos por comas ("" si ninguno). */
export function runningOwnersKey(containers: Container[] | null, fallback: string): string {
  return [...new Set((containers ?? []).filter((c) => c.state === "running").map((c) => c.owner ?? fallback))]
    .sort()
    .join(",");
}

export function engineLabel(engine: Engine): string {
  return engine === "podman" ? "Podman" : "Docker";
}

/** Nombre del usuario conectado en el panel (para el resto de dueños se usa su nombre). */
export function selfOwnerLabel(o: { isRoot: boolean; engine: Engine; rootless: boolean; me: string | null }): string {
  return o.isRoot ? "root" : o.engine === "docker" && !o.rootless ? "sistema" : (o.me ?? "tu usuario");
}

/** Texto de cada opción del selector «Usuario». */
export function ownerOptionLabel(
  o: CtOwner,
  ctx: { isRoot: boolean; engine: Engine; rootless: boolean; me: string | null },
): string {
  if (o.kind === "self") {
    if (ctx.isRoot) return "root";
    return ctx.engine === "docker" && !ctx.rootless ? "Docker del sistema" : `${ctx.me ?? "tu usuario"} (tú)`;
  }
  if (o.kind === "root") return "root (sistema)";
  return `${o.user.name}${o.user.runtimeDir ? "" : " · sin sesión abierta"}`;
}

/** Título del aviso de sudo / motor inaccesible. */
export function bannerTitle(o: {
  dockerSelfSudo: boolean;
  problem: string | null | undefined;
  all: boolean;
  current: CtOwner | null;
  waitingUsers: boolean;
}): string {
  if (o.dockerSelfSudo && o.problem) return o.problem;
  if (o.all) return "Ver los contenedores de todos los usuarios necesita sudo";
  if (o.current?.kind === "root") return "Los contenedores del sistema necesitan sudo";
  if (o.current?.kind === "user" || o.waitingUsers) return "Ver los contenedores de otro usuario necesita sudo";
  return o.problem ?? "Hace falta sudo";
}

/** Elevación conjunta de varios comandos: null si alguno la necesita y no hay; si no, la última que no es «none». */
export function combineElevation(els: (Elevation | null)[]): Elevation | null {
  let out: Elevation = NO_ELEVATION;
  for (const el of els) {
    if (!el) return null;
    if (el.kind !== "none") out = el;
  }
  return out;
}

/** Usuarios (que no son «tú») a los que afectan unos comandos, para mostrarlos; null si ninguno. */
export function otherOwnersText(cmds: Cmd[], fallback: string, label: (key: string) => string): string | null {
  const names = [...new Set(cmds.map((c) => c.owner ?? fallback))].filter((k) => k !== OWNER_SELF).map(label);
  return names.length ? names.join(", ") : null;
}
