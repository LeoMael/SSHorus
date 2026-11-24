// Pruebas de «Qué pueden ver tus usuarios» (aislamiento de usuarios sin sudo, túneles SSH, 127.0.0.1,
// /proc hidepid, HOME/web, cron/logs, Docker/contenedores y planes de arreglo).
// Ejecutar: npx rolldown src/features/admin/userVisibility.test.ts -p node -f esm -o /tmp/uv.mjs && node /tmp/uv.mjs
import { detectEnv } from "./commands";
import type { PortsResult } from "./ports";
import { noTunnelsNonAdminSteps, noTunnelsSshdSteps } from "./sshdConf";
import { analyzeUserVisibility, classifyLocalServices, openTunnelFlags, parseSshTunnels, USER_VISIBILITY_SCRIPT } from "./userVisibility";
import { buildVisibilityFixPlan, disableAllNonAdminTunnelsPlan } from "./userVisibilityPlans";
import { createKeyUserPlan } from "./keyUser";

declare const process: { exit(code: number): never };
const nodeModule = (name: string) => import(/* @vite-ignore */ name);

let passed = 0;
let failed = 0;
function ok(cond: unknown, msg: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`✗ ${msg}`);
  }
}
function eq<T>(a: T, b: T, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}

const PORTS: PortsResult = {
  tool: "ss",
  ports: [
    { key: "tcp|0.0.0.0|22", proto: "tcp", ip: "0.0.0.0", iface: null, port: 22, family: 4, scope: "public", procs: [{ name: "sshd", pid: 1 }], user: "root", unit: "sshd.service", container: null },
    { key: "tcp|127.0.0.1|6379", proto: "tcp", ip: "127.0.0.1", iface: null, port: 6379, family: 4, scope: "local", procs: [{ name: "redis-server", pid: 2 }], user: "redis", unit: "redis.service", container: null },
    { key: "tcp|127.0.0.1|5432", proto: "tcp", ip: "127.0.0.1", iface: null, port: 5432, family: 4, scope: "local", procs: [{ name: "postgres", pid: 3 }], user: "postgres", unit: "postgresql.service", container: null },
  ],
};

const EXPOSED_SERVER = [
  "@@id",
  "0 root",
  "@@passwd",
  "root:0:0:/root:/bin/bash",
  "admin:1000:1000:/home/admin:/bin/bash",
  "invitado:1001:1001:/home/invitado:/bin/bash",
  "cliente:1002:1002:/home/cliente:/bin/bash",
  "svc:1003:1003:/home/svc:/usr/sbin/nologin",
  "@@groups",
  "wheel:x:10:admin",
  "docker:x:998:invitado",
  "adm:x:4:invitado",
  "admin:x:1000:",
  "invitado:x:1001:",
  "cliente:x:1002:",
  "@@sudoers",
  "%wheel ALL=(ALL) ALL",
  "@@sshinc",
  "1",
  "@@sshtun",
  "invitado|yes|yes|yes|no|no",
  "cliente|no|no|no|no|no",
  "@@proc",
  "proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0",
  "@@homes",
  "admin|/home/admin|755|admin|admin",
  "invitado|/home/invitado|700|invitado|invitado",
  "cliente|/home/cliente|700|cliente|cliente",
  "@@webperm",
  "@dir /etc/caddy",
  "/etc/caddy/Caddyfile",
  "@group caddy",
  "@@cronlogs",
  "@cron /etc/crontab",
  "@log /var/log/caddy/access.log",
  "@@dockersock",
  "@sock /var/run/docker.sock|660|root|docker",
  "@run /tmp/sshorus-run-1000|755|admin|admin",
  "@@end",
].join("\n");

// 1. Servicios en 127.0.0.1
const locals = classifyLocalServices(PORTS);
eq(locals.length, 2, "dos servicios locales TCP");
ok(locals[0].port === 6379 && locals[0].likelyNoAuth, "redis primero y marcado sin auth");
ok(locals[1].port === 5432 && !locals[1].likelyNoAuth, "postgres marcado como con auth");

// 2. Parseo de sshd -T -C
const tun = parseSshTunnels(["invitado|yes|yes|no|no|no", "cliente|no|no|no|no|no"]);
eq(openTunnelFlags(tun.map.get("invitado")!), ["AllowTcpForwarding yes", "AllowStreamLocalForwarding yes"], "invitado tiene túneles");
eq(openTunnelFlags(tun.map.get("cliente")!), [], "cliente sin túneles");

// 3. Análisis completo por usuario sin sudo
const rep = analyzeUserVisibility(EXPOSED_SERVER, PORTS, true);
eq(rep.users.map((u) => u.user), ["invitado", "cliente"], "solo usuarios humanos sin sudo con shell interactiva (excluye admin y svc nologin)");
eq(rep.adminUsers, ["admin", "root"], "administradores detectados");

const inv = rep.users[0];
const cli = rep.users[1];
const byArea = (u: typeof inv) => new Map(u.checks.map((c) => [c.area, c]));
const invC = byArea(inv);
const cliC = byArea(cli);

eq(invC.get("tunnels")?.status, "bad", "invitado puede abrir túneles SSH");
eq(cliC.get("tunnels")?.status, "ok", "cliente NO puede abrir túneles SSH");
eq(invC.get("localServices")?.status, "bad", "invitado alcanza redis en 127.0.0.1");
eq(invC.get("processes")?.status, "bad", "sin hidepid ve procesos ajenos");
eq(invC.get("files")?.status, "bad", "ve /home/admin (755) y /etc/caddy/Caddyfile");
ok(invC.get("files")?.items.some((i) => i.includes("/home/admin")), "menciona /home/admin");
eq(invC.get("cronLogs")?.status, "bad", "invitado está en adm y hay log/cron abiertos");
eq(invC.get("containers")?.status, "bad", "invitado está en grupo docker y ve /tmp/sshorus-run-1000");
ok(inv.score !== null && cli.score !== null && inv.score < cli.score, "cliente aislado tiene mejor nota que invitado");

// 4. Planes de arreglo
const rocky = detectEnv(new Set(["useradd", "usermod", "gpasswd"]), "rocky", ["rhel"], ["wheel"]);
const pTun = buildVisibilityFixPlan("tunnels", inv, rep, rocky);
ok(pTun?.steps.some((s) => s.includes("AllowTcpForwarding no") && s.includes("Match User invitado")), "plan túneles por usuario");
ok(pTun?.steps.some((s) => s.includes("sshd -t")), "plan túneles valida con sshd -t");
const pGlobal = disableAllNonAdminTunnelsPlan(rep.adminGroups);
ok(pGlobal.steps.some((s) => s.includes("Match User !root Group !sudo,!wheel,!admin")), "plan túneles global excluye admins");
const pFiles = buildVisibilityFixPlan("files", inv, rep, rocky);
ok(pFiles?.steps.some((s) => s.includes("chmod 700 '/home/admin'")), "plan archivos cierra HOME");
ok(pFiles?.steps.some((s) => s.includes("chgrp -R caddy /etc/caddy")), "plan archivos protege /etc/caddy con grupo caddy");
const pCtr = buildVisibilityFixPlan("containers", inv, rep, rocky);
ok(pCtr?.steps.some((s) => s.includes("gpasswd -d 'invitado' 'docker'")), "plan contenedores quita de docker");
ok(pCtr?.steps.some((s) => s.includes("chmod 700 '/tmp/sshorus-run-1000'")), "plan contenedores cierra runtime dir");
eq(buildVisibilityFixPlan("localServices", inv, rep, rocky), null, "servicios 127.0.0.1 son recomendación manual");

// 5. KeyUserWizard: allowTunnels: false añade Match User sin túneles
const ku = createKeyUserPlan(rocky, {
  name: "cliente2",
  publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICZm9C4sWqQjlgtug0eu7n8xh8h3oGFuNpS0Rq3vCc5z c@host",
  shell: "/bin/bash",
  groups: [],
  admin: false,
  linger: false,
  allowTunnels: false,
});
ok(ku.steps.some((s) => s.includes("65-sshorus-sin-tuneles-cliente2.conf")), "crear usuario sin túneles escribe conf");
ok(ku.action.includes("sin túneles SSH"), "acción menciona sin túneles");

// 6. Sintaxis POSIX sh de todos los scripts generados (sh -n)
const { execFileSync } = await nodeModule("node:child_process");
for (const [label, script] of [
  ["USER_VISIBILITY_SCRIPT", USER_VISIBILITY_SCRIPT],
  ["noTunnelsSshdSteps", noTunnelsSshdSteps("invitado").join("\n")],
  ["noTunnelsNonAdminSteps", noTunnelsNonAdminSteps(["wheel"]).join("\n")],
  ["pFiles", pFiles!.steps.join("\n")],
  ["pCtr", pCtr!.steps.join("\n")],
] as const) {
  try {
    execFileSync("sh", ["-n"], { input: script, stdio: ["pipe", "pipe", "pipe"] });
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ sh -n falló en ${label}: ${String(e)}`);
  }
}

console.log(`userVisibility.test.ts: ${passed} ok, ${failed} fallos`);
if (failed > 0) process.exit(1);
