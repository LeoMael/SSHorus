// Áreas de la batería por distro (`npm run test:distros`): qué script de SSHorus se ejecuta en el
// contenedor y cómo se comprueba su salida. Los scripts y los parseadores son los MISMOS que usa la app
// (se importan de src/, no se copian): si la app cambia, la batería prueba lo nuevo.
//
// El ejecutor (run.mjs) empaqueta este archivo con rolldown, igual que las pruebas de la interfaz.
import { ACCOUNTS_SCRIPT, parseAccountsOutput } from "../../src/features/admin/accounts";
import { detectEnv } from "../../src/features/admin/commands";
import { buildUserRows, parseRead, READ_SCRIPT } from "../../src/features/admin/parse";
import { parsePorts, PORTS_SCRIPT, type PortsResult } from "../../src/features/admin/ports";
import { parseWeb, WEB_SCRIPT, type WebResult } from "../../src/features/admin/web";
import { runChecks } from "../../src/features/audit/checks";
import { sudoUsers } from "../../src/features/audit/checksCommon";
import { AUDIT_SCRIPT } from "../../src/features/audit/script";
import { statusText } from "../../src/features/infra/firewall/explain";
import { FIREWALL_SCRIPT, parseFirewallReport } from "../../src/features/infra/firewall/report";
import { buildConfig } from "../../src/features/serverConfig/build";
import { CONFIG_SCRIPT } from "../../src/features/serverConfig/script";
import { deriveMetrics } from "../../src/features/monitor/derive";
import { buildSampleCommand, parseSample } from "../../src/features/monitor/sample";
import { DETECT_COMMAND, parsePrivilegeOutput } from "../../src/features/privileges/detect";
import { buildExec, elevationFailure, elevationFailureMessage, type Elevation } from "../../src/features/privileges/elevate";
import { distroFamily, distroFromOsRelease, parseOsRelease, splitSections } from "../../src/lib/remote";

/** Lo que se espera de cada distro (lo rellena la tabla de run.mjs). */
export interface Expect {
  /** `ID` de /etc/os-release. */
  osId: string;
  family: string;
  adminGroup: string;
  /** Usuario de prueba (con contraseña y en el grupo de administración). */
  user: string;
  password: string;
  /** Hay nginx instalado (en el resto, «Sitios web» debe decir que no hay). */
  web: boolean;
}

/** Una ejecución en el servidor: el comando del canal exec y lo que va por stdin (como `snippets.execStdin`). */
export interface Run {
  command: string;
  stdin: string;
  timeoutSecs: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface Verdict {
  ok: boolean;
  detail: string;
  /** Líneas de más que se enseñan con --detalle (p. ej. las comprobaciones de la auditoría que no salen bien). */
  extra?: string[];
}

export interface Area {
  id: string;
  label: string;
  runs: (e: Expect) => Run[];
  check: (r: RunResult[], e: Expect) => Verdict;
}

/** Excepción que se convierte en ✗ con su motivo. */
class Fail extends Error {}

function must(cond: unknown, why: string): asserts cond {
  if (!cond) throw new Fail(why);
}

const sudo = (e: Expect): Elevation => ({ kind: "password", password: e.password });
const none: Elevation = { kind: "none" };

/** Como `runScript`: el script va por stdin con el arranque corto de `buildExec`. */
function script(inner: string, el: Elevation, timeoutSecs = 60): Run {
  const req = buildExec(inner, el);
  return { command: req.command, stdin: req.stdin, timeoutSecs };
}

/** Comando del canal exec tal cual (detección de privilegios y muestreo del monitor). */
function raw(command: string, timeoutSecs = 30): Run {
  return { command, stdin: "", timeoutSecs };
}

/** Falla si sudo no funcionó (contraseña, sudoers…) o si el script no terminó. */
function finished(r: RunResult, what: string): string {
  const f = elevationFailure(r.exitCode, r.stderr);
  must(!f, `${what}: ${f ? elevationFailureMessage(f) : ""}`);
  must(!r.timedOut, `${what}: tardó demasiado`);
  must(r.stdout.includes("@@end"), `${what}: salida incompleta (código ${r.exitCode}; ${r.stderr.trim().slice(0, 160) || "sin stderr"})`);
  return r.stdout;
}

function readEnv(stdout: string) {
  const read = parseRead(stdout);
  must(read.passwd.length > 0, "no se leyó /etc/passwd");
  return read;
}

export const AREAS: Area[] = [
  {
    id: "distro",
    label: "Distro y privilegios",
    runs: () => [raw(DETECT_COMMAND), script("cat /etc/os-release 2>/dev/null || cat /usr/lib/os-release 2>/dev/null; echo @@end", none)],
    check: ([det, osr], e) => {
      const p = parsePrivilegeOutput(det.stdout);
      must(p.level !== "unknown", `detección: ${p.error}`);
      must(p.distroId === e.osId, `distro «${p.distroId}», se esperaba «${e.osId}»`);
      const fam = distroFamily(p.distroId, p.distroLike);
      must(fam.family === e.family, `familia «${fam.family}», se esperaba «${e.family}»`);
      must(p.level === "sudo" && p.tool === "sudo", `nivel «${p.level}» (${p.tool ?? "sin herramienta"}), se esperaba sudo con contraseña`);
      const os = parseOsRelease(finished(osr, "os-release").replace(/@@end\s*$/, ""));
      const fam2 = distroFromOsRelease(os);
      must(fam2.family === e.family, `os-release: familia «${fam2.family}»`);
      return { ok: true, detail: `${os.PRETTY_NAME ?? e.osId} · ${fam.label} · ${p.user} con sudo (grupos: ${p.groups.join(" ")})` };
    },
  },
  {
    id: "users",
    label: "Usuarios y grupos",
    runs: (e) => [script(READ_SCRIPT, none, 20), script(ACCOUNTS_SCRIPT, sudo(e), 30)],
    check: ([rd, acc], e) => {
      const read = readEnv(finished(rd, "lectura"));
      must(read.me === e.user, `id -un dio «${read.me}»`);
      const shadow = parseAccountsOutput(finished(acc, "cuentas (sudo)"));
      const rows = buildUserRows(read, shadow);
      const t = rows.find((r) => r.name === e.user);
      must(t, `no aparece el usuario ${e.user}`);
      must(!t.isSystem && t.uid >= 1000, `${e.user} sale como cuenta del sistema (uid ${t.uid})`);
      must(t.groups.includes(e.adminGroup), `${e.user} no está en «${e.adminGroup}» (grupos: ${t.groups.join(", ")})`);
      must(t.isAdmin, `${e.user} no sale como administrador`);
      must(t.shadow?.status === "P", `contraseña de ${e.user}: «${t.shadow?.status ?? "sin leer"}»`);
      must(t.shadow?.sudo === "password", `sudo de ${e.user}: «${t.shadow?.sudo ?? "sin leer"}»`);
      must(rows.some((r) => r.name === "root" && r.uid === 0), "no aparece root");
      const env = detectEnv(read.tools, e.osId, [], read.groups.map((g) => g.name));
      must(env.toolset === "shadow", `herramientas «${env.toolset}» (faltan useradd…)`);
      must(env.adminGroup === e.adminGroup, `grupo de administración «${env.adminGroup}»`);
      must(read.shells.length > 0, "sin /etc/shells");
      return { ok: true, detail: `${rows.length} usuarios, ${read.groups.length} grupos; ${e.user}: admin (${e.adminGroup}), contraseña puesta, sudo con contraseña` };
    },
  },
  {
    id: "sessions",
    label: "Sesiones",
    runs: () => [script(READ_SCRIPT, none, 20)],
    check: ([rd], e) => {
      const out = finished(rd, "lectura");
      const s = splitSections(out);
      must(s.has("who") && s.has("lastlog"), "faltan las secciones who/lastlog");
      const read = readEnv(out);
      const env = detectEnv(read.tools, e.osId, [], read.groups.map((g) => g.name));
      must(env.killTool === "pkill", `cerrar sesiones: «${env.killTool ?? "no se puede"}» (pkill de procps no detectado)`);
      const who = read.who.length ? `${read.who.length} abiertas` : "ninguna abierta (normal en un contenedor sin utmp)";
      return { ok: true, detail: `sesiones: ${who}; último acceso: ${read.lastLogin.size} usuarios; cerrar con pkill` };
    },
  },
  {
    id: "ports",
    label: "Puertos",
    runs: (e) => [script(PORTS_SCRIPT, sudo(e), 30), script(PORTS_SCRIPT, none, 30)],
    check: ([root, user]) => {
      const pr = parsePorts(finished(root, "puertos (sudo)"));
      must(pr.tool === "ss", `herramienta «${pr.tool}», se esperaba ss`);
      const ssh = pr.ports.find((p) => p.proto === "tcp" && p.port === 22 && p.scope === "public");
      must(ssh, `sin el puerto 22 en escucha (leídos: ${pr.ports.map((p) => p.port).join(", ") || "ninguno"})`);
      must(ssh.procs.some((p) => p.name === "sshd"), `el 22 no dice su proceso (${JSON.stringify(ssh.procs)})`);
      must(ssh.user === "root", `dueño del 22: «${ssh.user}»`);
      const pu = parsePorts(finished(user, "puertos (sin sudo)"));
      must(pu.ports.some((p) => p.port === 22), "sin sudo no se ve el 22");
      return { ok: true, detail: `${pr.ports.length} en escucha (${[...new Set(pr.ports.map((p) => p.port))].join(", ")}); 22 → sshd (root)` };
    },
  },
  {
    id: "monitor",
    label: "Monitor",
    runs: () => [raw(buildSampleCommand({ full: true, uidAll: true })), raw(`sleep 1; ${buildSampleCommand({ full: false, uidAll: true })}`)],
    check: ([a, b], e) => {
      const prev = parseSample(a.stdout);
      const cur = parseSample(b.stdout);
      must(prev.complete && cur.complete, `muestra incompleta (${a.stderr.trim().slice(0, 120)})`);
      must(!prev.noProc, "no se puede leer /proc");
      const info = prev.info;
      must(info && info.nproc && info.hz && info.pageSize, `faltan datos fijos (${JSON.stringify(info)})`);
      must(info.user === e.user, `usuario «${info.user}»`);
      const m = deriveMetrics(prev, cur, {
        hz: info.hz,
        pageSize: info.pageSize,
        nproc: info.nproc,
        uidOf: (p) => cur.uids.get(p.pid) ?? prev.uids.get(p.pid) ?? null,
        userOf: (uid) => prev.users.get(uid) ?? null,
      });
      must(m.cpuPct !== null, "sin % de CPU");
      must(m.mem && m.mem.totalKb > 0, "sin memoria");
      must(m.load, "sin carga");
      must(m.disks.length > 0, "sin discos (df)");
      must(m.procCount >= 2, `solo ${m.procCount} procesos`);
      const sshd = m.procs.find((p) => p.comm.startsWith("sshd"));
      const all = cur.procs.map((p) => p.comm);
      must(all.some((c) => c.startsWith("sshd")), `no aparece sshd entre los procesos (${all.join(", ")})`);
      must(m.users.some((u) => u.user === "root"), `uso por usuario sin root (${m.users.map((u) => u.user).join(", ")})`);
      return {
        ok: true,
        detail: `CPU ${m.cpuPct.toFixed(0)} % · RAM ${m.mem.usedPct.toFixed(0)} % · ${m.procCount} procesos${sshd ? ` · sshd de ${sshd.user}` : ""} · ${m.disks.length} discos`,
      };
    },
  },
  {
    id: "audit",
    label: "Auditoría",
    runs: (e) => [script(AUDIT_SCRIPT, sudo(e), 180), script(PORTS_SCRIPT, sudo(e), 30), script(WEB_SCRIPT, sudo(e), 60)],
    check: ([au, po, we], e) => {
      const stdout = finished(au, "auditoría (sudo)");
      const ports: PortsResult = parsePorts(finished(po, "puertos"));
      const web: WebResult = parseWeb(finished(we, "sitios web"));
      const { checks, os } = runChecks({ stdout, elevated: true, ports, web, vuln: null, now: Date.now() });
      must(checks.length >= 20, `solo ${checks.length} comprobaciones`);
      const s = splitSections(stdout);
      must((s.get("sshdsrc") ?? [])[0] === "T", "sshd -T no respondió como root");
      must(!(s.get("shadow") ?? []).includes("@noread"), "no leyó /etc/shadow con sudo");
      const su = sudoUsers(s.get("groups") ?? [], s.get("sudoers") ?? []);
      must(su.includes(e.user), `${e.user} no sale entre los que tienen sudo (${su.join(", ")})`);
      const count = (st: string) => checks.filter((c) => c.status === st).length;
      const odd = checks.filter((c) => /undefined|NaN|null/.test(`${c.title} ${c.detail}`));
      must(odd.length === 0, `texto roto: ${odd.map((c) => `${c.id}: ${c.detail}`).join(" | ")}`);
      const sudoAsked = checks.filter((c) => /necesita sudo/.test(c.detail));
      must(sudoAsked.length === 0, `con sudo pide sudo: ${sudoAsked.map((c) => c.title).join(", ")}`);
      const upd = checks.find((c) => c.id === "updates.pending");
      must(upd && !/no reconocido/.test(upd.detail), `actualizaciones: «${upd?.detail}»`);
      return {
        ok: true,
        detail: `${os}: ${checks.length} comprobaciones (${count("ok")} bien, ${count("warn")} aviso, ${count("bad")} mal, ${count("info")} info, ${count("skip")} omitidas)`,
        extra: checks.filter((c) => c.status !== "ok").map((c) => `${c.status} · ${c.title}: ${c.detail}`),
      };
    },
  },
  {
    id: "config",
    label: "Configuración",
    runs: (e) => [script(CONFIG_SCRIPT, sudo(e), 120), script(CONFIG_SCRIPT, none, 120)],
    check: ([root, user], e) => {
      const out = finished(root, "configuración (sudo)");
      const cfg = buildConfig(out, true, null);
      const by = Object.fromEntries(cfg.sections.map((s) => [s.id, s]));
      must(cfg.sections.length === 8, `${cfg.sections.length} secciones`);
      must((splitSections(out).get("sshdsrc") ?? [])[0] === "T", "sshd -T no respondió como root");
      must(by.ssh.facts.length > 0 && by.ssh.status !== "skip", `SSH: «${by.ssh.summary}»`);
      must(by.sudo.facts.some((f) => f.value.split(", ").includes(e.user)), `sudo: ${e.user} no sale en ${JSON.stringify(by.sudo.facts)}`);
      must(by.sysctl.status !== "skip", "no se leyó /proc/sys");
      must(!/no se reconoce/.test(by.updates.summary), `actualizaciones: «${by.updates.summary}»`);
      must(by.hidepid.facts[0].value !== "?", "no se leyó /proc/mounts");
      const odd = cfg.sections.filter((s) => /undefined|NaN|null/.test(`${s.summary} ${s.facts.map((f) => f.value).join(" ")} ${s.groups.flatMap((g) => g.rows.map((r) => r.detail)).join(" ")}`));
      must(odd.length === 0, `texto roto: ${odd.map((s) => `${s.id}: ${s.summary}`).join(" | ")}`);
      const asked = cfg.sections.filter((s) => s.notes.some((n) => /Sin sudo/.test(n)));
      must(asked.length === 0, `con sudo pide sudo: ${asked.map((s) => s.id).join(", ")}`);
      const plain = buildConfig(finished(user, "configuración (sin sudo)"), false, null);
      const pb = Object.fromEntries(plain.sections.map((s) => [s.id, s]));
      must(pb.ssh.status === "skip" || pb.ssh.notes.some((n) => /sin sudo/i.test(n)), `sin sudo, SSH no dice que falta sudo: «${pb.ssh.summary}»`);
      return {
        ok: true,
        detail: cfg.sections.map((s) => `${s.title}: ${s.status}`).join(" · "),
        extra: cfg.sections.map((s) => `${s.status} · ${s.title}: ${s.summary}`),
      };
    },
  },
  {
    id: "firewall",
    label: "Cortafuegos",
    runs: (e) => [script(FIREWALL_SCRIPT, sudo(e), 45)],
    check: ([fw]) => {
      const rep = parseFirewallReport(finished(fw, "cortafuegos (sudo)"));
      const text = statusText(rep);
      must(rep.readable, `con sudo dice «${text}»`);
      must(!rep.active || rep.rules.length > 0, `«${text}» pero sin reglas`);
      must(text === "No hay ningún cortafuegos" || /instalado pero apagado$/.test(text), `estado inesperado: «${text}»`);
      return { ok: true, detail: `«${text}»${rep.notes.length ? ` · ${rep.notes.join(" ")}` : ""}` };
    },
  },
  {
    id: "web",
    label: "Sitios web",
    runs: (e) => [script(WEB_SCRIPT, sudo(e), 60)],
    check: ([w], e) => {
      const r = parseWeb(finished(w, "sitios web (sudo)"));
      if (!e.web) {
        must(r.servers.length === 0, `sin nginx ni Caddy dice que hay: ${r.servers.map((s) => s.server).join(", ")}`);
        return { ok: true, detail: "no hay nginx ni Caddy" };
      }
      const ng = r.servers.find((s) => s.server === "nginx");
      must(ng, "nginx instalado pero no aparece");
      must(!ng.warning || ng.source === "dump", `aviso: ${ng.warning}`);
      must(ng.sites.length > 0, "nginx sin sitios (la configuración por defecto trae uno)");
      return {
        ok: true,
        detail: `nginx (${ng.source}, estado: ${ng.status ?? "sin systemd"}): ${ng.sites.length} sitio(s), ${ng.sites.map((s) => s.names.join(" ") || "_").join("; ")}`,
      };
    },
  },
];

/** Fases del escáner (los scripts salen del motor, `vulnscan/tests_distros.rs`); las comprueba Rust. */
export function vulnRuns(scripts: { detect: string; users: string; inventory: string }, e: Expect): { name: string; run: Run }[] {
  return [
    { name: "detect", run: script(scripts.detect, none, 60) },
    { name: "users", run: script(scripts.users, sudo(e), 60) },
    { name: "inventory", run: script(scripts.inventory, none, 120) },
  ];
}

/** Ejecuta la comprobación sin dejar escapar excepciones: un fallo es ✗ con su motivo. */
export function judge(area: Area, results: RunResult[], e: Expect): Verdict {
  try {
    return area.check(results, e);
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
