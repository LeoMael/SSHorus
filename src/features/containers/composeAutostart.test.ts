// Pruebas del arranque solo de proyectos de podman-compose: lectura (script real con un HOME de mentira),
// decisión (plantilla sí/no, registrado sí/no, podman-compose o solo el plugin docker-compose, linger
// sí/no) y comandos de cada camino.
import { autostartOwner, decideAutostart, parseAutostart, type OwnerAutostart } from "./autostart";
import type { AutostartTarget, PlanCtx } from "./autostartPlan";
import { composeFactsLines, decideComposeAutostart, parseComposeFacts, type ComposeFacts, type ComposeTarget } from "./composeAutostart";
import { composeAutostartPlan, composeGroups } from "./composeAutostartPlan";
import { renderCmd } from "./shell";
import type { Container } from "./types";

// Sin @types/node en el proyecto: se carga a mano lo justo para ejecutar `sh`.
const CHILD = "node:child_process";
const FS = "node:fs";
const OS = "node:os";
const { execFileSync } = (await import(/* @vite-ignore */ CHILD)) as {
  execFileSync: (cmd: string, args: string[], opts?: { encoding: "utf8"; env?: Record<string, string> }) => string;
};
const fs = (await import(/* @vite-ignore */ FS)) as {
  mkdtempSync: (p: string) => string;
  mkdirSync: (p: string, o: { recursive: boolean }) => void;
  writeFileSync: (p: string, d: string) => void;
  rmSync: (p: string, o: { recursive: boolean; force: boolean }) => void;
};
const { tmpdir } = (await import(/* @vite-ignore */ OS)) as { tmpdir: () => string };

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const PROJ = "seguimiento_siu";
const UNIT = `podman-compose@${PROJ}.service`;
const ID_DB = "3f2a9c1e5b7d40a8b6c2e1f09a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b";
const ID_WEB = "9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c";
const OWNER = "u:leo_oti";

// ── El script de lectura, de verdad, con un HOME de mentira ──
const home = fs.mkdtempSync(`${tmpdir()}/sshorus-pc-`);
try {
  const run = () =>
    parseComposeFacts(
      execFileSync("sh", ["-c", [`set -f`, `units='${UNIT} web.service'`, ...composeFactsLines()].join("\n")], {
        encoding: "utf8",
        env: { HOME: home, PATH: "/usr/bin:/bin" },
      }).replace(/^@@tv:pcompose\n/, ""),
    );
  let f = run();
  eq([f.templates.filter((t) => t.startsWith(home)), [...f.registered], [...f.enabled]], [[], [], []], "HOME vacío: nada");
  fs.mkdirSync(`${home}/.config/systemd/user/default.target.wants`, { recursive: true });
  fs.mkdirSync(`${home}/.config/containers/compose/projects`, { recursive: true });
  fs.writeFileSync(`${home}/.config/systemd/user/podman-compose@.service`, "[Service]\n");
  fs.writeFileSync(`${home}/.config/containers/compose/projects/${PROJ}.env`, "COMPOSE_PROJECT_NAME=x\n");
  f = run();
  eq([f.templates.includes(`${home}/.config/systemd/user/podman-compose@.service`), [...f.registered], [...f.enabled]], [true, [PROJ], []], "plantilla y registro");
  fs.writeFileSync(`${home}/.config/systemd/user/default.target.wants/${UNIT}`, "");
  eq([...run().enabled], [PROJ], "enlace de enable");
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

// ── Lectura completa y decisión de «¿arranca solo?» ──
function out(pcompose: string[], linger: "yes" | "no"): string {
  return [
    "@@tv:inspect",
    `${ID_DB}|no|${UNIT}`,
    `${ID_WEB}|no|${UNIT}`,
    "@@tv:service",
    "",
    "@@tv:units",
    "@@tv:sysunits",
    "@@tv:pcompose",
    ...pcompose,
    "@@tv:linger",
    linger,
    "@@tv:end",
  ].join("\n");
}
const BIN = "bin=/usr/bin/podman-compose";
const TPL = "template=/etc/systemd/user/podman-compose@.service";
const scope = { engine: "podman" as const, userMode: true };

// Lo del informe: sin plantilla ni registro, el gestor del usuario parado (units vacío), sin linger.
const raw = parseAutostart(out([BIN, "dcompose=no"], "no"));
eq([raw.compose?.bin, raw.compose?.templates.length, raw.linger], ["/usr/bin/podman-compose", 0, false], "lee podman-compose");
const info = decideAutostart(ID_DB, raw, scope, "5.4.0");
eq([info?.verdict, info?.missing], ["no", ["compose", "linger"]], "ya no es un callejón: falta preparar el servicio y linger");
eq(info?.why.some((l) => l.includes("plantilla")), true, "explica la plantilla");

const ready = parseAutostart(out([BIN, TPL, `registered=${PROJ}`, `enabled=${PROJ}`], "yes"));
eq(decideAutostart(ID_DB, ready, scope, "5.4.0")?.verdict, "yes", "plantilla + registrado + enlace + linger: sí (sin systemctl --user)");
eq(decideAutostart(ID_DB, parseAutostart(out([BIN, TPL, `registered=${PROJ}`, `enabled=${PROJ}`], "no")), scope, "5.4.0")?.missing, ["linger"], "solo falta linger");

// ── Decisión del camino ──
const facts = (extra: Partial<ComposeFacts>): ComposeFacts => ({ bin: "/usr/bin/podman-compose", dockerCompose: false, templates: [], registered: new Set(), enabled: new Set(), ...extra });
const tgt: ComposeTarget = { project: PROJ, dir: "/home/leo_oti/seguimiento_siu", files: ["docker-compose.yml"], inPod: true };
const both = { templates: ["/x/podman-compose@.service"], registered: new Set([PROJ]) };

let d = decideComposeAutostart(tgt, facts(both), true);
eq([d.choice, d.steps, d.why.includes("ya está registrado")], ["service", ["enable"], true], "plantilla y registro: solo habilitar");
d = decideComposeAutostart(tgt, facts({}), true);
eq([d.choice, d.steps], ["service", ["create-unit", "register", "enable"]], "sin plantilla ni registro: prepararlo");
d = decideComposeAutostart(tgt, facts({ templates: ["/x"] }), false);
eq(d.steps, ["linger", "register", "enable"], "sin linger: primero linger");
d = decideComposeAutostart(tgt, facts({ bin: null, dockerCompose: true }), true);
eq([d.choice, d.serviceOk, d.why.includes("docker-compose")], ["restart", false, true], "solo el plugin docker-compose: política de reinicio");
d = decideComposeAutostart({ ...tgt, dir: null }, facts({}), true);
eq([d.choice, d.serviceOk], ["restart", false], "sin carpeta ni registro: no se puede registrar");
d = decideComposeAutostart({ ...tgt, dir: null }, facts(both), true);
eq(d.serviceOk, true, "ya registrado: no hace falta la carpeta");
d = decideComposeAutostart({ ...tgt, inPod: false }, facts(both), true);
eq([d.choice, d.serviceOk, d.warnings.length], ["restart", true, 1], "sin pod: se recomienda la política, con aviso");

// ── Grupos y comandos ──
function ctr(id: string, name: string, pod: string | null): Container {
  return {
    ...({} as Container),
    id,
    name,
    owner: OWNER,
    pod,
    composeProject: PROJ,
    composeWorkingDir: "/home/leo_oti/seguimiento_siu",
    composeConfigFiles: "docker-compose.yml",
  };
}
const containers = [ctr(ID_DB, "seguimiento-siu-db", `pod_${PROJ}`), ctr(ID_WEB, "seguimiento-siu-web", `pod_${PROJ}`)];
const target = (id: string, name: string, f: OwnerAutostart): AutostartTarget => ({ id, name, owner: OWNER, info: decideAutostart(id, f, scope, "5.4.0")! });
const owner = autostartOwner({ kind: "user", user: { name: "leo_oti", uid: 1001, home: "/home/leo_oti", podman: true, docker: false, linger: false, runtimeDir: false } }, { engine: "podman", isRoot: false, rootless: true, selfSudo: false });
const ctx = (f: OwnerAutostart): PlanCtx => ({ engine: "podman", version: "5.4.0", owner: () => owner, facts: () => f });

const groups = composeGroups([target(ID_DB, "seguimiento-siu-db", raw), target(ID_WEB, "seguimiento-siu-web", raw)], containers);
eq(groups.map((g) => [g.owner, g.project, g.dir, g.files, g.inPod, g.targets.length]), [[OWNER, PROJ, "/home/leo_oti/seguimiento_siu", ["docker-compose.yml"], true, 2]], "un grupo por proyecto");

const svc = composeAutostartPlan(groups[0], ctx(raw));
eq(
  svc?.cmds.map((c) => [c.owner, renderCmd(c).split(" ").slice(0, 4).join(" ")]),
  [
    ["root", "loginctl enable-linger leo_oti"],
    ["root", "sh -c 'u=$(id -u"],
    [OWNER, "sh -c 'd=\"$HOME/.config/systemd/user\"; t=\"$d/podman-compose@.service\";"],
    [OWNER, "cd /home/leo_oti/seguimiento_siu && podman-compose"],
    [OWNER, "systemctl --user daemon-reload"],
    [OWNER, `systemctl --user enable --now`],
  ],
  "servicio: linger (root), plantilla, registro y habilitar (como el dueño)",
);
eq(renderCmd(svc!.cmds[3]), `cd /home/leo_oti/seguimiento_siu && podman-compose -p ${PROJ} -f docker-compose.yml systemd -a register`, "registro desde su carpeta");
eq(renderCmd(svc!.cmds[5]), `systemctl --user enable --now ${UNIT}`, "habilitar y arrancar");

const noPc = parseAutostart(out(["bin=", "dcompose=yes"], "no"));
const g2 = composeGroups([target(ID_DB, "seguimiento-siu-db", noPc)], containers)[0];
const rp = composeAutostartPlan(g2, ctx(noPc));
eq(rp?.choice, "restart", "sin podman-compose: política");
eq(
  rp?.cmds.map((c) => [c.owner, renderCmd(c)]),
  [
    ["root", "loginctl enable-linger leo_oti"],
    [OWNER, "podman update --restart always seguimiento-siu-db"],
    [OWNER, "env SYSTEMCTL_INSTALL_CLIENT_SIDE=1 systemctl --user enable podman-restart.service"],
  ],
  "política: linger, always (Podman < 5.8.2) y podman-restart.service",
);
eq(composeAutostartPlan(g2, ctx(noPc), "service")?.choice, "restart", "no se puede forzar el servicio sin podman-compose");
eq(composeAutostartPlan(groups[0], ctx(raw), "restart")?.choice, "restart", "con podman-compose también se puede elegir la política");

console.log(`compose al arrancar: ${passed} pruebas correctas`);
