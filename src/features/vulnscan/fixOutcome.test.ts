// Pruebas de «Arreglar dice la verdad» (funciones puras): qué traen los repositorios, la salida de dnf,
// el resultado por paquete, «Por qué sigue apareciendo» y el informe de antes de un reinicio.
import type { Report } from "../../api/vulnscan";
import { crossReports } from "./crossCheck";
import { fixSuggestion } from "./fixCommand";
import { fixOutcomes, nothingInstalled, outcomeSummary, upgradeIssues } from "./fixOutcome";
import { fixKind, groupFindings } from "./fixPlan";
import { finding, report } from "./fixtures";
import { repoFix, repoOffers } from "./repo";
import { parseBootCheck, staleReason } from "./stale";
import { whyStill } from "./why";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(cond: boolean, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}

// Rocky 9 con dnf: openssl tiene la corregida en los repositorios; curl todavía no.
const ssl = finding({ id: "CVE-2026-0101", package: "openssl", binaries: ["openssl-libs"], installed: "3.5.1-4.el9_7", fixed: "1:3.5.1-9.el9_7" });
const curl = finding({ id: "CVE-2026-0102", package: "curl", binaries: ["curl", "libcurl"], installed: "7.76.1-31.el9", fixed: "7.76.1-35.el9_7" });
const kern = finding({ id: "CVE-2026-0103", package: "kernel", binaries: ["kernel-core"], kernel: true, installed: "5.14.0-503.el9_5", fixed: "5.14.0-570.el9_6" });
function rocky(findings = [ssl, curl, kern], host: Partial<Report["host"]> = {}): Report {
  const r = report("rocky", "rpm", findings, ["dnf"]);
  r.host = { ...r.host, kernel: "5.14.0-503.el9_5.x86_64", repoUpgrades: { "openssl-libs": "1:3.5.1-9.el9_7", curl: "7.76.1-33.el9_7" }, noRepoFix: [curl.key], ...host };
  return r;
}
const before = rocky();

// ── ¿Está en tus repositorios? ──
eq([repoFix(before, ssl), repoFix(before, curl)], ["yes", "no"], "lo decide el motor (noRepoFix)");
eq(repoFix(report("rocky", "rpm", [ssl], ["dnf"]), ssl), "unknown", "informe viejo o sin dnf: no se sabe");
eq(repoOffers(before, curl), ["curl 7.76.1-33.el9_7"], "lo más nuevo que ofrecen");
eq([fixKind(before, ssl), fixKind(before, curl)], ["now", "norepo"], "sin la corregida en los repos no se ofrece «Arreglar»");
eq(groupFindings(before, before.findings).norepo.map((f) => f.package), ["curl"], "su propio grupo");
ok(fixSuggestion(before, curl).notes.some((n) => n.startsWith("Aún no hay versión corregida en tus repositorios")), "la sugerencia lo avisa");

// ── Salida de dnf ──
const NOTHING = "Last metadata expiration check: 0:00:02 ago on Tue Nov 25 10:00:00 2026.\nDependencies resolved.\nNothing to do.\nComplete!\n";
const EXCLUDED = "All matches were filtered out by exclude filtering for argument: libcurl\nDependencies resolved.\nNothing to do.\nComplete!\n";
const PROBLEM =
  "Error: \n Problem: cannot install the best update candidate for package openssl-libs-1:3.5.1-4.el9_7.x86_64\n  - nothing provides libz.so.2 needed by openssl-libs-1:3.5.1-9.el9_7.x86_64\n";
const pkgs = ["openssl-libs", "openssl", "curl", "libcurl", "kernel-core", "kernel"];
eq(upgradeIssues(NOTHING, pkgs), { byPackage: {}, general: null, nothingToDo: true }, "dnf: Nothing to do");
eq(upgradeIssues(EXCLUDED, pkgs).byPackage, { libcurl: "All matches were filtered out by exclude filtering for argument: libcurl" }, "excluido en dnf.conf");
const prob = upgradeIssues(PROBLEM, pkgs);
eq(Object.keys(prob.byPackage), ["openssl-libs"], "el conflicto es de openssl-libs (por su NEVRA, no de openssl)");
eq(prob.general, "Problem: cannot install the best update candidate for package openssl-libs-1:3.5.1-4.el9_7.x86_64", "error general");
eq(upgradeIssues("E: Unable to locate package curl\n", pkgs).byPackage.curl, "E: Unable to locate package curl", "apt");

// ── Resultado por paquete ──
// Después: openssl arreglado; curl no cambió (no está en los repos); kernel nuevo instalado, falta reiniciar.
const after = rocky([{ ...curl }, { ...kern, needsReboot: true, installed: "5.14.0-503.el9_5" }], { rebootKernel: "5.14.0-570.el9_6" });
const out = fixOutcomes([ssl, curl, kern], after, { tool: "needs-restarting", services: [], reboot: true }, upgradeIssues(NOTHING, pkgs), null);
eq(out.map((o) => `${o.package}:${o.status}`), ["curl:norepo", "kernel:reboot", "openssl:fixed"], "cada paquete con lo que pasó de verdad");
ok(out[0].detail?.includes("solo llegan a curl 7.76.1-33.el9_7") ?? false, "curl: por qué no se instaló");
eq(outcomeSummary(out), "Arreglado: 1 · Instalado, falta reiniciar el servidor: 1 · Sin versión corregida en tus repos todavía: 1", "resumen");
eq(nothingInstalled(out), false, "algo se instaló");

const withSvc = fixOutcomes([ssl], rocky([]), { tool: "needs-restarting", services: ["nginx.service"], reboot: false }, upgradeIssues("", pkgs), null);
eq([withSvc[0].status, withSvc[0].detail?.includes("nginx.service")], ["restart", true], "arreglado pero con servicios que reiniciar");

// Nada que hacer: código 0, pero no es un éxito.
const same = rocky([ssl, curl], { noRepoFix: [] });
const none = fixOutcomes([ssl, curl], same, null, upgradeIssues(NOTHING, pkgs), null);
eq(none.map((o) => o.status), ["norepo", "norepo"], "«Nothing to do»: sin versión corregida");
ok(none[0].detail?.includes("Nothing to do") ?? false, "lo dice el gestor de paquetes");
eq(nothingInstalled(none), true, "no se instaló nada");

// Falló: la línea de dnf que lo explica.
const failed = fixOutcomes([ssl, curl], same, null, upgradeIssues(`${PROBLEM}${EXCLUDED}`, pkgs), "dnf terminó con código 1");
eq(failed.map((o) => [o.package, o.status, o.detail]), [
  ["curl", "failed", "All matches were filtered out by exclude filtering for argument: libcurl"],
  ["openssl", "failed", "Problem: cannot install the best update candidate for package openssl-libs-1:3.5.1-4.el9_7.x86_64"],
], "falló, con su línea");

// Se actualizó, pero la nueva sigue afectada. Y un informe viejo sin epoch no cuenta como «cambió».
const partial = fixOutcomes([curl], rocky([{ ...curl, installed: "7.76.1-33.el9_7" }]), null, upgradeIssues("", pkgs), null);
eq([partial[0].status, partial[0].detail?.includes("7.76.1-33.el9_7")], ["partial", true], "actualizado pero sigue afectado");
eq(crossReports([ssl], rocky([{ ...ssl, installed: "1:3.5.1-4.el9_7" }], { noRepoFix: [ssl.key] })).remaining[0].reason, "norepo", "mismo paquete con y sin epoch: no cambió");

// ── Por qué sigue apareciendo ──
ok(whyStill(before, curl)[0].startsWith("Aún no hay versión corregida en tus repositorios"), "sin la corregida en los repos");
ok(whyStill(before, curl).some((l) => l.includes("sudo dnf --refresh check-update curl libcurl")), "cómo comprobarlo");
ok(whyStill(before, ssl)[0].includes("pulsa «Arreglar»"), "ya está en los repos");
const rebootRep = rocky([kern], { rebootKernel: "5.14.0-570.el9_6", bootKernel: "5.14.0-503.el9_5.x86_64" });
const kWhy = whyStill(rebootRep, { ...kern, needsReboot: true });
ok(kWhy[0].includes("sigue usando el viejo") && kWhy.some((l) => l.includes("grubby --set-default /boot/vmlinuz-5.14.0-570.el9_6.x86_64")), "kernel: el arranque por defecto no cambió");
ok(whyStill(before, finding({ target: "image:podman::abc" }))[0].includes("«Actualizar imagen»"), "imagen");
ok(whyStill(before, finding({ hasFix: false, fixed: null }))[0].startsWith("Todavía no hay versión corregida publicada"), "sin arreglo");

// ── Informe de antes de un reinicio ──
const now = parseBootCheck("@@bootid\nbbbb-2222\n@@kernel\n5.14.0-570.el9_6.x86_64\n@@end\n");
eq(now, { bootId: "bbbb-2222", kernel: "5.14.0-570.el9_6.x86_64" }, "arranque de ahora");
ok(staleReason(rocky([], { bootId: "aaaa-1111" }), now)?.startsWith("El servidor se reinició después de este análisis") ?? false, "otro arranque");
ok(staleReason(rocky([]), now)?.includes("5.14.0-503.el9_5.x86_64 → 5.14.0-570.el9_6.x86_64") ?? false, "informe viejo sin boot_id: el kernel cambió");
eq(staleReason(rocky([], { bootId: "bbbb-2222", kernel: "5.14.0-570.el9_6.x86_64" }), now), null, "mismo arranque");

console.log(`fixOutcome.test.ts: ${passed} comprobaciones correctas`);

if ((globalThis as { __vitest_worker__?: unknown }).__vitest_worker__) {
  const runner = "vitest";
  const { test } = (await import(/* @vite-ignore */ runner)) as { test: (name: string, fn: () => void) => void };
  test(`fixOutcome.test.ts: ${passed} comprobaciones`, () => {});
}
