// Pruebas de «¿Arranca solo?»: lectura de la salida del script, decisión y comandos para activarlo.
// Ejecutar: npx rolldown src/features/containers/autostart.test.ts -p node -f esm -o /tmp/as.mjs && node /tmp/as.mjs
import {
  autostartOwner,
  autostartPolicy,
  autostartScript,
  canUpdateRestart,
  decideAutostart,
  parseAutostart,
  versionAtLeast,
  type AutostartOwner,
  type AutostartScope,
  type OwnerAutostart,
} from "./autostart";
import { autostartPlan, type AutostartTarget } from "./autostartPlan";
import { renderCmd } from "./shell";
import type { CtOwner } from "./owner";
import type { Engine } from "./types";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(cond: boolean, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}

const ID_A = "3f2a9c1e5b7d40a8b6c2e1f09a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b";
const ID_B = "9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c";
const ID_Q = "c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00";

// ── Salidas reales (formato de `inspect --format`, `systemctl is-enabled`, `systemctl show`, loginctl) ──

// leo_oti: Podman rootless sin Quadlet, con linger, podman-restart.service de usuario sin habilitar.
const LEO = [
  "@@tv:inspect",
  `${ID_A}|always|`,
  `${ID_B}||`,
  "",
  "@@tv:service",
  "disabled",
  "@@tv:units",
  "@@tv:linger",
  "yes",
  "@@tv:end",
].join("\n");

// tesis: Quadlet (web.container → web.service, generado, con [Install] WantedBy=default.target).
const TESIS = [
  "@@tv:inspect",
  `${ID_Q}|no|web.service`,
  "@@tv:service",
  "",
  "@@tv:units",
  "Id=web.service",
  "UnitFileState=generated",
  "WantedBy=default.target",
  "RequiredBy=",
  "",
  "@@tv:linger",
  "yes",
  "@@tv:end",
].join("\n");

// Docker del sistema.
const DOCKER = [
  "@@tv:inspect",
  `${ID_A}|unless-stopped|`,
  `${ID_B}|no|`,
  "@@tv:service",
  "enabled",
  "@@tv:units",
  "@@tv:end",
].join("\n");

const podUser: AutostartScope = { engine: "podman", userMode: true };
const podRoot: AutostartScope = { engine: "podman", userMode: false };
const dockSys: AutostartScope = { engine: "docker", userMode: false };

// ── parseAutostart ──
const leo = parseAutostart(LEO);
eq(leo.policies.get(ID_A), { policy: "always", unit: null }, "política always");
eq(leo.policies.get(ID_B), { policy: "no", unit: null }, "política vacía = no");
eq(leo.service, "disabled", "servicio deshabilitado");
eq(leo.linger, true, "linger sí");
const tesis = parseAutostart(TESIS);
eq(tesis.policies.get(ID_Q)?.unit, "web.service", "unidad de Quadlet");
eq(tesis.service, null, "servicio sin dato");
eq(tesis.units.get("web.service"), { fileState: "generated", wanted: true }, "unidad generada y pedida por default.target");
eq(parseAutostart(DOCKER).linger, null, "sin linger en Docker del sistema");
eq(parseAutostart("@@tv:linger\nno\n@@tv:end").linger, false, "linger no");

// ── versiones ──
eq(versionAtLeast("5.0.3", [5, 1, 0]), false, "5.0.3 < 5.1");
eq(versionAtLeast("5.1.0", [5, 1, 0]), true, "5.1.0");
eq(versionAtLeast("6.1.1", [5, 8, 2]), true, "6.1.1");
eq(versionAtLeast("4.9.4-rhel", [5, 1, 0]), false, "4.9 con sufijo");
eq(versionAtLeast(null, [5, 1, 0]), true, "sin versión: se intenta");
eq(canUpdateRestart("podman", "4.9.4"), false, "podman 4 no tiene update --restart");
eq(canUpdateRestart("docker", "20.10"), true, "docker siempre");
eq(autostartPolicy("podman", "5.4.0"), "always", "podman viejo: always");
eq(autostartPolicy("podman", "6.1.1"), "unless-stopped", "podman nuevo: unless-stopped");
eq(autostartPolicy("docker", null), "unless-stopped", "docker: unless-stopped");

// ── decideAutostart ──
const a = decideAutostart(ID_A, leo, podUser, "6.1.1");
eq(a?.verdict, "no", "always sin podman-restart.service: no");
eq(a?.missing, ["service"], "falta el servicio");
const b = decideAutostart(ID_B, leo, podUser, "6.1.1");
eq(b?.missing, ["policy", "service"], "sin política ni servicio");
eq(decideAutostart(ID_A.slice(0, 12), leo, podUser, "6.1.1")?.policy, "always", "id corto");
eq(decideAutostart("deadbeef0000", leo, podUser, "6.1.1"), null, "desconocido");

const withSvc: OwnerAutostart = { ...leo, service: "enabled" };
eq(decideAutostart(ID_A, withSvc, podUser, "6.1.1")?.verdict, "yes", "always + servicio + linger: sí");
eq(decideAutostart(ID_A, { ...withSvc, linger: false }, podUser, "6.1.1")?.verdict, "no", "sin linger: nunca");
eq(decideAutostart(ID_A, { ...withSvc, linger: false }, podUser, "6.1.1")?.missing, ["linger"], "falta linger");
eq(decideAutostart(ID_A, { ...withSvc, linger: null }, podUser, "6.1.1")?.verdict, "unknown", "linger sin dato");
eq(decideAutostart(ID_A, { ...withSvc, linger: null }, podRoot, "6.1.1")?.verdict, "yes", "rootful no necesita linger");

const us: OwnerAutostart = { ...withSvc, policies: new Map([[ID_A, { policy: "unless-stopped", unit: null }]]) };
eq(decideAutostart(ID_A, us, podUser, "6.1.1")?.verdict, "yes", "unless-stopped en podman ≥ 5.8.2");
eq(decideAutostart(ID_A, us, podUser, "5.4.0")?.verdict, "no", "unless-stopped en podman viejo");
const of: OwnerAutostart = { ...withSvc, policies: new Map([[ID_A, { policy: "on-failure", unit: null }]]) };
eq(decideAutostart(ID_A, of, podUser, "6.1.1")?.verdict, "no", "on-failure: podman no lo arranca al encender");

const q = decideAutostart(ID_Q, tesis, podUser, "6.1.1");
eq([q?.verdict, q?.unit, q?.missing], ["yes", "web.service", []], "Quadlet habilitado con linger: sí");
const qOff: OwnerAutostart = { ...tesis, units: new Map([["web.service", { fileState: "generated", wanted: false }]]) };
eq(decideAutostart(ID_Q, qOff, podUser, "6.1.1")?.verdict, "no", "Quadlet sin [Install]: no");
eq(decideAutostart(ID_Q, { ...tesis, linger: false }, podUser, "6.1.1")?.missing, ["linger"], "Quadlet sin linger: solo linger");
eq(decideAutostart(ID_Q, { ...tesis, units: new Map() }, podUser, "6.1.1")?.verdict, "unknown", "Quadlet sin datos de la unidad");

const dock = parseAutostart(DOCKER);
eq(decideAutostart(ID_A, dock, dockSys, "27.0")?.verdict, "yes", "docker unless-stopped + servicio");
eq(decideAutostart(ID_B, dock, dockSys, "27.0")?.missing, ["policy"], "docker no");
eq(decideAutostart(ID_A, { ...dock, service: "disabled" }, dockSys, "27.0")?.verdict, "no", "docker sin docker.service");
ok(!!decideAutostart(ID_A, dock, dockSys, "27.0")?.why.some((l) => l.includes("docker.service")), "el porqué nombra docker.service");

// ── autostartOwner ──
const user = (name: string): CtOwner => ({ kind: "user", user: { name, uid: 1001, home: `/home/${name}`, podman: true, docker: true, runtimeDir: true } });
const pctx = { engine: "podman" as Engine, isRoot: false, rootless: true, selfSudo: false };
eq(autostartOwner({ kind: "self" }, pctx), { key: "self", scope: podUser, rootKey: "root", linger: { owner: "self", user: null } }, "podman tú sin root");
eq(autostartOwner({ kind: "root" }, pctx).scope, podRoot, "podman root");
eq(autostartOwner(user("leo_oti"), pctx).linger, { owner: "root", user: "leo_oti" }, "linger de otro usuario como root");
eq(autostartOwner({ kind: "self" }, { ...pctx, isRoot: true }), { key: "self", scope: podRoot, rootKey: "self", linger: null }, "conexión root");
eq(autostartOwner(user("ana"), { ...pctx, engine: "docker" }).scope, { engine: "docker", userMode: true, machineUser: "ana" }, "docker rootless de otro");
eq(autostartOwner({ kind: "self" }, { engine: "docker", isRoot: false, rootless: false, selfSudo: false }).rootKey, null, "docker por grupo: sin root");
eq(autostartOwner({ kind: "self" }, { engine: "docker", isRoot: false, rootless: false, selfSudo: true }).rootKey, "self", "docker con sudo");

// ── autostartScript ──
const sU = autostartScript(podUser);
ok(sU.includes("podman inspect --format '{{.Id}}|{{.HostConfig.RestartPolicy.Name}}|{{index .Config.Labels \"PODMAN_SYSTEMD_UNIT\"}}' $ids"), "inspect en lote");
ok(sU.includes("systemctl --user is-enabled podman-restart.service"), "servicio de usuario");
ok(sU.includes("@@tv:linger"), "lee linger sin root");
ok(!autostartScript(dockSys).includes("@@tv:linger"), "sin linger con root");
ok(autostartScript({ engine: "docker", userMode: true, machineUser: "ana" }).includes("systemctl --user -M ana@ is-enabled docker.service"), "docker de otro usuario");

// ── autostartPlan ──
const owners: Record<string, AutostartOwner> = {
  "u:leo_oti": autostartOwner(user("leo_oti"), pctx),
  "u:tesis": autostartOwner(user("tesis"), pctx),
};
const facts: Record<string, OwnerAutostart> = { "u:leo_oti": { ...leo, linger: false }, "u:tesis": tesis };
const ctx = (version: string) => ({ engine: "podman" as Engine, version, owner: (k: string) => owners[k] ?? null, facts: (k: string) => facts[k] ?? null });
const target = (id: string, name: string, owner: string): AutostartTarget => {
  const info = decideAutostart(id, facts[owner], owners[owner].scope, "6.1.1");
  if (!info) throw new Error("sin info");
  return { id, name, owner, info };
};
const p1 = autostartPlan(true, [target(ID_B, "web", "u:leo_oti")], ctx("6.1.1"));
eq(
  p1.cmds.map((c) => [c.owner, renderCmd(c)]),
  [
    ["root", "loginctl enable-linger leo_oti"],
    ["u:leo_oti", "podman update --restart unless-stopped web"],
    ["u:leo_oti", "env SYSTEMCTL_INSTALL_CLIENT_SIDE=1 systemctl --user enable podman-restart.service"],
  ],
  "rootless sin linger: linger, política y servicio",
);
const p2 = autostartPlan(true, [target(ID_B, "web", "u:leo_oti")], ctx("4.9.4"));
eq(p2.cmds.map(renderCmd).some((c) => c.includes("update")), false, "podman 4: no hay update");
ok(p2.notes.some((n) => n.includes("volver a crear")), "podman 4: explica que hay que recrearlo");
const p3 = autostartPlan(true, [target(ID_Q, "systemd-web", "u:tesis")], ctx("6.1.1"));
eq(p3.cmds, [], "Quadlet: no se toca");
ok(p3.notes[0].includes("web.service"), "Quadlet: lo explica");
const p4 = autostartPlan(false, [target(ID_A, "db", "u:leo_oti"), target(ID_Q, "systemd-web", "u:tesis")], ctx("6.1.1"));
eq(p4.cmds.map((c) => [c.owner, renderCmd(c)]), [["u:leo_oti", "podman update --restart no db"]], "apagar: política no");
eq(p4.notes.length, 1, "apagar Quadlet: nota");

const dOwner = autostartOwner({ kind: "self" }, { engine: "docker", isRoot: false, rootless: false, selfSudo: true });
const dFacts = { ...dock, service: "disabled" };
const dInfo = (id: string) => decideAutostart(id, dFacts, dOwner.scope, "27.0")!;
const p5 = autostartPlan(
  true,
  [
    { id: ID_A, name: "a", owner: "self", info: dInfo(ID_A) },
    { id: ID_B, name: "b", owner: "self", info: dInfo(ID_B) },
  ],
  { engine: "docker", version: "27.0", owner: () => dOwner, facts: () => dFacts },
);
eq(p5.cmds.map(renderCmd), ["docker update --restart unless-stopped b", "systemctl enable docker.service"], "docker: política y servicio");

console.log(`autostart: ${passed} pruebas correctas`);
