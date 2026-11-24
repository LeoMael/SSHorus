// Pruebas de la lógica pura del panel de Contenedores: qué cargar, qué motor usar, nombres y avisos.
// Ejecutar: npx rolldown src/features/containers/panelLogic.test.ts -p node -f esm -o /tmp/ctp.mjs && node /tmp/ctp.mjs
import type { CtOwner } from "./owner";
import type { EngineStatus } from "./detect";
import type { Container } from "./types";
import type { Elevation } from "../privileges/elevate";
import {
  bannerTitle,
  combineElevation,
  engineLabel,
  neededResources,
  otherOwnersText,
  ownerOptionLabel,
  pickStatus,
  runningOwnersKey,
  selfOwnerLabel,
} from "./panelLogic";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

// ── neededResources ──
eq(neededResources("containers", false), ["containers"], "contenedores");
eq(neededResources("compose", true), ["containers"], "compose");
eq(neededResources("images", false), ["images", "containers"], "imágenes");
eq(neededResources("volumes", false), ["volumes"], "volúmenes");
eq(neededResources("networks", false), ["networks", "containers"], "redes");
eq(neededResources("cleanup", false), ["df", "containers", "images", "volumes"], "limpieza");
eq(neededResources("cleanup", true), [], "limpieza con «Todos»");

// ── pickStatus ──
function st(engine: "podman" | "docker", accessible: boolean): EngineStatus {
  return {
    engine,
    installed: true,
    version: null,
    accessible,
    rootless: false,
    needsSudo: !accessible,
    problem: null,
    rawError: null,
    serviceDown: false,
    compose: [],
  };
}
const podmanNo = st("podman", false);
const dockerOk = st("docker", true);
eq(pickStatus([podmanNo, dockerOk], "podman")?.engine, "podman", "el elegido aunque necesite sudo");
eq(pickStatus([podmanNo, dockerOk], null)?.engine, "docker", "sin elegir: el accesible");
eq(pickStatus([podmanNo], "docker")?.engine, "podman", "elegido que no está: el primero");
eq(pickStatus([], null), null, "ninguno");

// ── runningOwnersKey ──
const c = (state: string, owner?: string) => ({ state, owner }) as unknown as Container;
eq(runningOwnersKey(null, "self"), "", "sin lista");
eq(runningOwnersKey([c("exited", "root")], "self"), "", "ninguno en marcha");
eq(runningOwnersKey([c("running", "u:ana"), c("running"), c("running", "root"), c("running", "u:ana")], "self"), "root,self,u:ana", "dueños únicos y ordenados");

// ── nombres ──
eq(engineLabel("podman"), "Podman", "Podman");
eq(engineLabel("docker"), "Docker", "Docker");
eq(selfOwnerLabel({ isRoot: true, engine: "podman", rootless: true, me: "ana" }), "root", "root");
eq(selfOwnerLabel({ isRoot: false, engine: "docker", rootless: false, me: "ana" }), "sistema", "Docker del sistema");
eq(selfOwnerLabel({ isRoot: false, engine: "podman", rootless: true, me: null }), "tu usuario", "sin nombre");
const ctx = { isRoot: false, engine: "podman" as const, rootless: true, me: "ana" };
const user = (name: string, runtimeDir: boolean): CtOwner => ({
  kind: "user",
  user: { name, uid: 1001, home: `/home/${name}`, podman: true, docker: false, runtimeDir },
});
eq(ownerOptionLabel({ kind: "self" }, ctx), "ana (tú)", "tú");
eq(ownerOptionLabel({ kind: "self" }, { ...ctx, isRoot: true }), "root", "tú siendo root");
eq(ownerOptionLabel({ kind: "self" }, { ...ctx, engine: "docker", rootless: false }), "Docker del sistema", "Docker del sistema");
eq(ownerOptionLabel({ kind: "root" }, ctx), "root (sistema)", "root");
eq(ownerOptionLabel(user("luis", true), ctx), "luis", "usuario con sesión");
eq(ownerOptionLabel(user("luis", false), ctx), "luis · sin sesión abierta", "usuario sin sesión");

// ── bannerTitle ──
const base = { dockerSelfSudo: false, problem: "Sin permiso", all: false, current: { kind: "self" } as CtOwner | null, waitingUsers: false };
eq(bannerTitle({ ...base, dockerSelfSudo: true }), "Sin permiso", "Docker sin permiso: su motivo");
eq(bannerTitle({ ...base, dockerSelfSudo: true, problem: null, all: true }), "Ver los contenedores de todos los usuarios necesita sudo", "sin motivo: sigue");
eq(bannerTitle({ ...base, current: { kind: "root" } }), "Los contenedores del sistema necesitan sudo", "root");
eq(bannerTitle({ ...base, current: null, waitingUsers: true }), "Ver los contenedores de otro usuario necesita sudo", "esperando usuarios");
eq(bannerTitle(base), "Sin permiso", "tú: el motivo");
eq(bannerTitle({ ...base, problem: null }), "Hace falta sudo", "sin motivo");

// ── combineElevation ──
const sudo = { kind: "sudo" } as unknown as Elevation;
eq(combineElevation([]), { kind: "none" }, "sin comandos");
eq(combineElevation([{ kind: "none" }, sudo, { kind: "none" }]), sudo, "alguno con sudo");
eq(combineElevation([sudo, null]), null, "falta la contraseña");

// ── otherOwnersText ──
const names: Record<string, string> = { root: "root", "u:ana": "ana" };
const label = (k: string) => names[k] ?? k;
eq(otherOwnersText([{ bin: ["podman"], args: [] }], "self", label), null, "solo tú");
eq(otherOwnersText([{ bin: ["podman"], args: [] }], "root", label), "root", "dueño por defecto");
eq(
  otherOwnersText(
    [
      { bin: ["podman"], args: [], owner: "u:ana" },
      { bin: ["podman"], args: [], owner: "root" },
      { bin: ["podman"], args: [], owner: "u:ana" },
    ],
    "self",
    label,
  ),
  "ana, root",
  "varios, sin repetir",
);

console.log(`panelLogic: ${passed} comprobaciones correctas`);
