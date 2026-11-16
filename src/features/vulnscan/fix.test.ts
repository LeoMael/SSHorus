// Pruebas de «Arreglar» y «Volver a comprobar» (funciones puras): grupos, comando único por distro,
// cruce del informe viejo con el nuevo y servicios a reiniciar.
// Ejecutar: npx rolldown src/features/vulnscan/fix.test.ts -p node -f esm -o /tmp/fx.mjs && node /tmp/fx.mjs
// (también con `npx vitest run`: las comprobaciones corren al cargar el archivo y cuentan como una prueba).
import type { Finding, Report, Target } from "../../api/vulnscan";
import { byReason, crossReports, crossSummary } from "./crossCheck";
import { fixSuggestion, kernelSuggestion } from "./fixCommand";
import { fixKind, groupFindings, packageChoices, upgradeCommand } from "./fixPlan";
import { parseRestart, restartCommand } from "./restart";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

function finding(p: Partial<Finding>): Finding {
  const f: Finding = {
    key: "",
    id: "CVE-2026-0001",
    aliases: [],
    advisories: [],
    package: "openssl",
    binaries: ["libssl3", "openssl"],
    installed: "3.0.11-1",
    fixed: "3.0.15-1",
    hasFix: true,
    severity: "high",
    distroSeverity: null,
    cvss: null,
    cvssVector: null,
    unimportant: false,
    status: null,
    summary: null,
    target: "system",
    sources: ["osv"],
    kernel: false,
    ecosystem: null,
    upstream: false,
    ...p,
  };
  return { ...f, key: p.key ?? `${f.id}|${f.package}|${f.target}` };
}

const targets: Target[] = [
  { key: "system", kind: "system", label: "Sistema", user: null, ecosystem: null, packages: 1, image: null, sources: [], error: null },
  { key: "runtime", kind: "runtime", label: "Programas sueltos", user: null, ecosystem: null, packages: 1, image: null, sources: [], error: null },
  { key: "image:podman::abc", kind: "image", label: "Imagen", user: null, ecosystem: null, packages: 1, image: null, sources: [], error: null },
];

function report(osId: string, pm: Report["host"]["packageManager"], findings: Finding[], tools: string[] = []): Report {
  return {
    id: "r1",
    serverId: "s1",
    createdAt: "2026-11-16T10:00:00Z",
    durationMs: 1,
    elevated: false,
    host: {
      os: { id: osId, idLike: [], versionId: "", version: "", versionCodename: "", prettyName: "", name: "" },
      kernel: "",
      arch: "x86_64",
      packageManager: pm,
      ecosystem: null,
      inContainer: false,
      tools,
    },
    sources: [],
    targets,
    programs: [],
    findings,
    summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0, total: 0, withFix: 0, unimportant: 0 },
    notes: [],
    ai: null,
    osvSample: [],
  };
}

// ── Grupos ──
const ssl = finding({});
const zlib = finding({ id: "CVE-2026-0002", package: "zlib", binaries: ["zlib1g"], fixed: null, hasFix: false });
const kern = finding({ id: "CVE-2026-0003", package: "linux", binaries: ["linux-image-6.1.0-18-amd64"], kernel: true, needsReboot: true });
const img = finding({ id: "CVE-2026-0004", target: "image:podman::abc" });
const node = finding({ id: "CVE-2026-0005", package: "node", binaries: ["/home/a/.nvm/node"], target: "runtime", upstream: true });
const hidden = finding({ id: "CVE-2026-0006", unimportant: true });
const deb = report("debian", "dpkg", [ssl, zlib, kern, img, node, hidden]);
const g = groupFindings(deb, deb.findings);
eq(
  Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((f) => f.id)])),
  { now: ["CVE-2026-0001"], reboot: ["CVE-2026-0003"], nofix: ["CVE-2026-0002"], image: ["CVE-2026-0004"], manual: ["CVE-2026-0005"] },
  "cada hallazgo en su grupo (y los «sin importancia» fuera)",
);
eq(fixKind(report("arch", null, []), ssl), "manual", "gestor de paquetes desconocido: a mano");
eq(fixSuggestion(deb, kern).command, null, "kernel ya arreglado: no se propone actualizar, solo reiniciar");
eq(kernelSuggestion(deb, [kern]).notes[0].startsWith("Ya está arreglado en el kernel nuevo"), true, "fila del kernel: reiniciar");

// ── Un solo comando por distro ──
const curl = finding({ id: "CVE-2026-0010", package: "curl", binaries: ["curl", "libcurl4"], severity: "critical" });
const ssl2 = finding({ id: "CVE-2026-0011", package: "openssl", binaries: ["libssl3"] });
const evil = finding({ id: "CVE-2026-0012", package: "x", binaries: ["x;rm -rf /"] });
const choices = packageChoices([ssl, curl, ssl2, evil]);
eq(choices.map((c) => c.name), ["curl", "openssl", "x"], "por paquete, el más grave primero");
eq(choices[1].binaries, ["libssl3", "openssl"], "binarios sin repetir");
eq(choices[1].findings.length, 2, "dos vulnerabilidades en openssl");
eq(choices[2].binaries, [], "nombres raros fuera (no van al shell)");
const bins = choices.flatMap((c) => c.binaries);
eq(
  upgradeCommand(deb, bins),
  "apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q --only-upgrade -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold curl libcurl4 libssl3 openssl",
  "apt: un solo comando, sin preguntas",
);
eq(upgradeCommand(report("rocky", "rpm", [], ["dnf"]), ["curl", "openssl-libs"]), "dnf upgrade -y --refresh curl openssl-libs", "dnf");
eq(upgradeCommand(report("centos", "rpm", [], ["yum"]), ["curl"]), "yum update -y curl", "yum");
eq(upgradeCommand(report("alpine", "apk", []), ["openssl", "libcrypto3"]), "apk update && apk upgrade libcrypto3 openssl", "apk");
eq(
  upgradeCommand(report("opensuse-leap", "rpm", []), ["curl"]),
  "zypper --non-interactive refresh && zypper --non-interactive update curl",
  "zypper",
);
eq(upgradeCommand(deb, []), null, "nada que actualizar");
eq(upgradeCommand(report("arch", null, []), ["curl"]), null, "distro desconocida");

// ── Cruce: arreglado / sigue / motivo ──
const before = [ssl, curl, zlib, finding({ id: "CVE-2026-0020", package: "glibc", binaries: ["libc6"] }), finding({ id: "CVE-2026-0021", package: "sudo", binaries: ["sudo"] }), finding({ id: "CVE-2026-0003", package: "linux", kernel: true })];
const after = report("debian", "dpkg", [
  // openssl: arreglado (ya no está). curl: se actualizó pero la versión nueva sigue afectada.
  { ...curl, installed: "7.88.1-10+deb12u8" },
  // zlib: sin versión corregida todavía.
  zlib,
  // glibc: la versión instalada no cambió (el repositorio no tenía la corregida).
  finding({ id: "CVE-2026-0020", package: "glibc", binaries: ["libc6"] }),
  // kernel: el nuevo ya está instalado, falta reiniciar.
  finding({ id: "CVE-2026-0003", package: "linux", kernel: true, needsReboot: true }),
  // sudo: arreglado. Una nueva que no estaba antes no cuenta en el cruce.
  finding({ id: "CVE-2026-0099", package: "bash", binaries: ["bash"] }),
]);
const x = crossReports(before, after);
eq(x.fixed.map((f) => f.package).sort(), ["openssl", "sudo"], "arreglados");
eq(
  x.remaining.map((r) => `${r.f.package}:${r.reason}`).sort(),
  ["curl:stillAffected", "glibc:notUpdated", "linux:reboot", "zlib:nofix"],
  "lo que sigue y por qué",
);
eq(crossSummary(x), "Arreglado: 2 · Siguen: 4", "resumen");
eq(byReason(x.remaining).map((r) => r.reason), ["reboot", "notUpdated", "stillAffected", "nofix"], "orden de los motivos");
eq(crossReports([img], report("debian", "dpkg", [img])).remaining[0].reason, "otherSource", "imagen: otra fuente");

// ── Servicios a reiniciar ──
const nr = parseRestart("@@tool\nneedrestart\n@@services\nnginx.service\nsshd.service\ndbus.service\nnginx.service\n@@reboot\n@@end\n");
eq(nr, { tool: "needrestart", services: ["nginx.service", "sshd.service"], reboot: true }, "needrestart: dbus pide reiniciar el servidor");
const dnf = parseRestart("@@tool\nneeds-restarting\n@@services\nchronyd\nbad name;x\n@@reboot\nyes\n@@end\n");
eq(dnf, { tool: "needs-restarting", services: ["chronyd.service"], reboot: true }, "needs-restarting");
eq(parseRestart("@@tool\n@@services\n@@reboot\n@@end\n"), { tool: null, services: [], reboot: false }, "sin herramienta");
eq(restartCommand("nginx.service"), "systemctl restart nginx.service", "reiniciar un servicio");
eq(restartCommand("x;reboot"), null, "nombre raro");

console.log(`fix.test.ts: ${passed} comprobaciones correctas`);

// Con vitest hace falta al menos una prueba registrada; sin él, `vitest` no se carga.
if ((globalThis as { __vitest_worker__?: unknown }).__vitest_worker__) {
  const runner = "vitest";
  const { test } = (await import(/* @vite-ignore */ runner)) as { test: (name: string, fn: () => void) => void };
  test(`fix.test.ts: ${passed} comprobaciones`, () => {});
}
