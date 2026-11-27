// Pruebas de Paquetes con salidas reales: dnf 4 (Rocky 9) y dnf 5 (Fedora), apt (Debian y Ubuntu),
// zypper (openSUSE Leap) y apk (Alpine): actualizaciones, cuáles son de seguridad, búsqueda, lo que se
// quitaría y los comandos de cada cambio. Los scripts se comprueban con `sh -n`.
import { installChange, removeChange, upgradeAllChange, upgradeSecurityChange, upgradeSomeChange } from "./changes";
import { installedScript, searchScript, simulateRemoveScript, updatesScript } from "./managers";
import { parseAptUpdates, parseApkUpdates, parseDnfSecurity, parseDnfUpdates, parseUpdatesOutput, parseZypperUpdates } from "./parse";
import { isCriticalPackage, markInstalled, parseRemoval, parseSearch, removalBlocked, validPackage } from "./search";

const CHILD = "node:child_process";
const { spawnSync } = (await import(/* @vite-ignore */ CHILD)) as {
  spawnSync: (cmd: string, args: string[], opts: { encoding: "utf8"; input?: string }) => { status: number | null; stderr: string };
};

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}

// ───────── dnf 4 (Rocky 9) ─────────
const DNF4 = [
  "",
  "kernel.x86_64                          5.14.0-427.22.1.el9_4           baseos",
  "openssl-libs.x86_64                    1:3.0.7-27.el9                  baseos",
  "python3-libselinux.x86_64",
  "                                       3.6-1.el9                       baseos",
  "caddy.x86_64                           2.8.4-1.el9                     copr:copr.fedorainfracloud.org:group_caddy:caddy",
  "Obsoleting Packages",
  "grub2-tools.x86_64                     1:2.06-80.el9                   baseos",
  "    grub2-tools.x86_64                 1:2.06-77.el9                   @baseos",
];
const d4 = parseDnfUpdates(DNF4);
eq(d4.map((u) => [u.name, u.version]), [["kernel", "5.14.0-427.22.1.el9_4"], ["openssl-libs", "1:3.0.7-27.el9"], ["python3-libselinux", "3.6-1.el9"], ["caddy", "2.8.4-1.el9"]], "dnf 4 (con línea partida, sin «Obsoleting»)");
const sec4 = parseDnfSecurity(["RLSA-2024:3501 Important/Sec.  kernel-5.14.0-427.22.1.el9_4.x86_64", "RLSA-2024:3339 Moderate/Sec.   openssl-libs-1:3.0.7-27.el9.x86_64", "RLBA-2024:1234 bugfix  caddy-2.8.4-1.el9.x86_64"]);
eq([...sec4].sort(), ["kernel", "openssl-libs"], "seguridad en dnf 4");
const sec5 = parseDnfSecurity([
  "Name                     Type     Severity Package                     Issued",
  "FEDORA-2024-2b7f9e7b59   security Moderate curl-8.6.0-10.fc40.x86_64   2024-11-01 01:23:45",
]);
eq([...sec5], ["curl"], "seguridad en dnf 5");
const rocky = parseUpdatesOutput(["@@mgr", "dnf", "@@root", "0", "@@kernel", "5.14.0-362.el9.x86_64", "@@updates", ...DNF4, "@@sec", "RLSA-2024:3501 Important/Sec.  kernel-5.14.0-427.22.1.el9_4.x86_64", "@@rc", "100", "@@err", "@@end"].join("\n"));
eq([rocky.manager, rocky.updates.length, rocky.securityCount, rocky.error, rocky.root], ["dnf", 4, 1, null, true], "Rocky: 4 pendientes, 1 de seguridad");
eq(rocky.updates[0].name, "kernel", "las de seguridad, primero");
const off = parseUpdatesOutput("@@mgr\ndnf\n@@updates\n@@rc\n1\n@@err\nError: Failed to download metadata for repo 'baseos'\n@@end\n");
ok(off.error && /Failed to download/.test(off.error), "dnf sin red: su error");
const dnf5 = parseDnfUpdates(["Updating and loading repositories:", "Repositories loaded.", "curl.x86_64     8.6.0-10.fc40     updates", "vim-minimal.x86_64 2:9.1.785-1.fc40 updates"]);
eq(dnf5.map((u) => u.name), ["curl", "vim-minimal"], "dnf 5");

// ───────── apt (Debian 12 y Ubuntu 24.04) ─────────
const apt = parseAptUpdates([
  "Listing...",
  "libssl3/stable-security 3.0.15-1~deb12u1 amd64 [upgradable from: 3.0.14-1~deb12u2]",
  "tzdata/stable-updates 2024b-0+deb12u1 all [upgradable from: 2024a-0+deb12u1]",
  "curl/noble-updates,noble-security 8.5.0-2ubuntu10.5 amd64 [upgradable from: 8.5.0-2ubuntu10.4]",
]);
eq(apt.map((u) => [u.name, u.security, u.current]), [["libssl3", true, "3.0.14-1~deb12u2"], ["tzdata", false, "2024a-0+deb12u1"], ["curl", true, "8.5.0-2ubuntu10.4"]], "apt con seguridad");
const deb = parseUpdatesOutput("@@mgr\napt\n@@updates\nListing...\n@@rc\n0\n@@err\nWARNING: apt does not have a stable CLI interface. Use with caution in scripts.\n@@end\n");
eq([deb.updates.length, deb.error, deb.warning, deb.securityCount], [0, null, null, 0], "apt al día, sin el aviso de la CLI");

// ───────── zypper (openSUSE Leap 15.6) ─────────
const ZYP = `<?xml version='1.0'?>
<stream>
<update-status version="0.6">
<update-list>
<update kind="package" name="curl" edition="8.6.0-150600.4.6.1" arch="x86_64" edition-old="8.6.0-150600.4.3.1" >
<summary>A Tool for Transferring Data from URLs</summary>
<source url="http://download.opensuse.org/update/leap/15.6/sle" alias="repo-sle-update"/>
</update>
<update kind="package" name="libzypp" edition="17.35.8-150600.3.8.1" arch="x86_64" edition-old="17.35.1-150600.3.3.1" ><summary>Library</summary></update>
</update-list>
</update-status>
</stream>`.split("\n");
eq(parseZypperUpdates(ZYP).map((u) => [u.name, u.current, u.repo]), [["curl", "8.6.0-150600.4.3.1", "repo-sle-update"], ["libzypp", "17.35.1-150600.3.3.1", null]], "zypper XML");
const suse = parseUpdatesOutput(["@@mgr", "zypper", "@@updates", ...ZYP, "@@sec", "3", "@@rc", "106", "@@err", "Repository 'x' is invalid.", "@@end"].join("\n"));
eq([suse.updates.length, suse.securityCount, suse.error], [2, 3, null], "zypper: código 106 es un aviso, 3 parches de seguridad");

// ───────── apk (Alpine 3.20) ─────────
eq(
  parseApkUpdates(["busybox-1.36.1-r29 x86_64 {busybox} (GPL-2.0-only) [upgradable from: busybox-1.36.1-r28]", "Installed:                                Available:", "musl-1.2.5-r0             < 1.2.5-r1"]).map((u) => [u.name, u.version, u.current]),
  [["busybox", "1.36.1-r29", "1.36.1-r28"], ["musl", "1.2.5-r1", "1.2.5-r0"]],
  "apk list -u y apk version",
);

// ───────── Búsqueda ─────────
eq(parseSearch("dnf", ["======== Name Exactly Matched: nginx ========", "nginx.x86_64 : A high performance web server and reverse proxy server", "nginx-mod-stream.x86_64 : Nginx stream modules"]).map((f) => f.name), ["nginx", "nginx-mod-stream"], "dnf 4 search");
eq(parseSearch("dnf", ["Matched fields: name (exact)", " nginx.x86_64\tA high performance web server"]).map((f) => f.summary), ["A high performance web server"], "dnf 5 search");
eq(parseSearch("apt", ["nginx - small, powerful, scalable web/proxy server", "nginx-common - small, powerful, scalable web/proxy server - common files"]).map((f) => f.name), ["nginx", "nginx-common"], "apt-cache search");
const zs = parseSearch("zypper", ["S  | Name         | Summary                       | Type", "---+--------------+-------------------------------+--------", "   | nginx        | A HTTP server and IMAP proxy  | package", "i+ | vim          | Vi IMproved                   | package", "   | nginx        | A HTTP server and IMAP proxy  | srcpackage"]);
eq(zs.map((f) => [f.name, f.installed]), [["nginx", false], ["vim", true]], "zypper search con estado");
eq(parseSearch("apk", ["nginx-1.26.2-r0 - HTTP and reverse proxy server (stable version)"]).map((f) => f.name), ["nginx"], "apk search");
eq(markInstalled(parseSearch("apt", ["nginx - web", "curl - tool"]), ["curl"]).map((f) => f.installed), [false, true], "marcar instalados");
ok(validPackage("python3.11-pip") && !validPackage("a;b") && !validPackage("-rf") && !validPackage("a b"), "validar nombres");

// ───────── Quitar: simulación y avisos ─────────
const DNF_RM = [
  "Dependencies resolved.",
  "================================================================================",
  " Package              Arch       Version                Repository        Size",
  "================================================================================",
  "Removing:",
  " openssh-server       x86_64     8.7p1-38.el9           @baseos          1.4 M",
  "Removing unused dependencies:",
  " openssh              x86_64     8.7p1-38.el9           @baseos          1.9 M",
  " python3-libselinux-very-long-name",
  "                      x86_64     3.6-1.el9              @baseos          0.7 M",
  "",
  "Transaction Summary",
  "================================================================================",
  "Remove  2 Packages",
];
eq(parseRemoval("dnf", DNF_RM), ["openssh-server", "openssh", "python3-libselinux-very-long-name"], "dnf remove --assumeno (con línea partida)");
ok(
  removalBlocked(["Error: ", " Problem: The operation would result in removing the following protected packages: sudo", "(try to add '--skip-broken' …)"])?.includes("sudo es un paquete protegido"),
  "dnf: paquete protegido (Rocky 9)",
);
eq(removalBlocked(["Remv nginx [1.22.1-9]"]), null, "nada bloqueado");
eq(parseRemoval("apt", ["Remv nginx [1.22.1-9]", "Remv libnginx-mod-http-geoip:amd64 [1.22.1-9]"]), ["nginx", "libnginx-mod-http-geoip"], "apt -s remove");
eq(parseRemoval("zypper", ["The following 2 packages are going to be REMOVED:", "  nginx vim", "", "2 packages to remove."]), ["nginx", "vim"], "zypper --dry-run");
eq(parseRemoval("apk", ["(1/2) Purging nginx (1.26.2-r0)", "(2/2) Purging pcre2 (10.43-r0)"]), ["nginx", "pcre2"], "apk del -s");
const rmSsh = removeChange("dnf", "openssh-server", ["openssh-server", "openssh"], "5.14.0-362.el9.x86_64");
ok(rmSsh?.danger && /openssh-server, openssh/.test(rmSsh.note ?? "") && /también este paquete/.test(rmSsh.explain), "quitar SSH: aviso fuerte");
ok(removeChange("apt", "linux-image-6.1.0-26-amd64", null, "6.1.0-26-amd64")?.note?.includes("kernel en uso (6.1.0-26-amd64)"), "quitar el kernel");
ok(!removeChange("apt", "nginx", ["nginx"], null)?.danger, "quitar nginx: sin aviso fuerte");
ok(["sudo", "systemd", "kernel-core", "glibc", "openssh-server", "apk-tools"].every(isCriticalPackage) && !isCriticalPackage("nginx"), "paquetes críticos");
eq(removeChange("dnf", "$(reboot)", null, null), null, "nombre raro: no hay cambio");

// ───────── Comandos de cada cambio ─────────
eq(upgradeAllChange("dnf", 4)?.steps, ["dnf upgrade -y --refresh"], "dnf: todo");
eq(upgradeAllChange("apt", 2)?.steps[0].startsWith("apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -q"), true, "apt: todo sin preguntas");
eq(upgradeSecurityChange(rocky)?.steps, ["dnf upgrade -y --refresh --security"], "dnf: solo seguridad");
const debSec = upgradeSecurityChange({ ...deb, updates: apt });
ok(debSec?.steps[0].includes("--only-upgrade") && /curl libssl3$/.test(debSec.steps[0]), `apt: los marcados (${debSec?.steps[0]})`);
eq(upgradeSecurityChange({ ...deb, manager: "apk", updates: [] }), null, "apk no distingue la seguridad");
eq(upgradeSomeChange("zypper", ["curl"])?.steps, ["zypper --non-interactive refresh && zypper --non-interactive update curl"], "zypper: uno (como «Arreglar»)");
eq(installChange("apk", "nginx")?.steps, ["apk add nginx"], "apk add");
eq(installChange("dnf", "a b"), null, "no se instala un nombre con espacios");

// ───────── Scripts ─────────
for (const [what, s] of [
  ["updates", updatesScript(false)],
  ["updates refresh", updatesScript(true)],
  ["search", searchScript("apt", "ngi'nx")],
  ["installed", installedScript("dnf", ["nginx", "curl"]) ?? ""],
  ["simulate", simulateRemoveScript("zypper", "nginx")],
] as const) {
  const r = spawnSync("sh", ["-n"], { encoding: "utf8", input: s });
  ok(r.status === 0, `${what}: sh -n falló: ${r.stderr}`);
}
ok(updatesScript(true).includes("apt-get update -q >/dev/null") && !updatesScript(false).includes("apt-get update"), "bajar la lista solo si se pide");
ok(searchScript("apt", "ngi'nx").includes("apt-cache search 'ngi'\\''nx'"), "el término va citado");

console.log(`paquetes: ${passed} pruebas bien`);
