// Lectura de un VPS para el panel: UN solo comando por ronda y su análisis (funciones puras).
//
// Mismas reglas que el muestreo del Monitor (features/monitor/sample.ts): va entre comillas simples,
// así que dentro no puede haber comillas simples, barras invertidas ni "!"; solo lee (/proc, df, id,
// systemctl, docker/podman ps); nada se instala ni se escribe. Secciones que empiezan con "@@nombre".
// Los análisis de /proc y df se reutilizan del Monitor.
import { parseOsRelease, splitSections } from "../../lib/remote";
import { ADMIN_GROUPS } from "../privileges/detect";
import { cpuPercent, memMetrics, type MemMetrics } from "../monitor/derive";
import { parseCpu, parseDf, parseLoadavg, parseMeminfo, parseUptime, type CpuTicks, type DiskUsage } from "../monitor/sample";

export const PROBE_TIMEOUT_SECS = 20;
/** Pausa entre las dos lecturas de CPU de la primera ronda (después, se compara con la ronda anterior). */
export const WARMUP_MS = 1000;

const SAFE_USER = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}$/;

export interface ProbeOptions {
  /** Usuarios guardados del VPS: se mira si existen y si tienen sudo (por grupo) o son root. */
  users: string[];
  /** Primera ronda: dos lecturas de CPU separadas por WARMUP_MS para tener el % enseguida. */
  warmup: boolean;
}

export function buildProbeCommand(opts: ProbeOptions): string {
  const users = [...new Set(opts.users.filter((u) => SAFE_USER.test(u)))].slice(0, 32);
  const parts: string[] = [
    "echo @@begin",
    // Límite para lo que puede colgarse (docker, df con montajes de red). Los busybox antiguos usan otra
    // sintaxis («timeout -t»): se prueba antes de usarlo.
    'T=""; if timeout 2 true >/dev/null 2>&1; then T="timeout 8"; fi',
    'if [ -r /proc/stat ]; then :; else echo @@noproc; fi',
    'echo @@stat; grep "^cpu " /proc/stat 2>/dev/null',
  ];
  if (opts.warmup) parts.push(`sleep ${WARMUP_MS / 1000}`, 'echo @@stat2; grep "^cpu " /proc/stat 2>/dev/null');
  parts.push(
    "echo @@mem; cat /proc/meminfo 2>/dev/null",
    "echo @@load; cat /proc/loadavg 2>/dev/null",
    "echo @@up; cat /proc/uptime 2>/dev/null",
    'echo @@nproc; nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null',
    "echo @@host; hostname 2>/dev/null || cat /etc/hostname 2>/dev/null",
    "echo @@os; grep ^PRETTY_NAME= /etc/os-release 2>/dev/null",
    // Debian/Ubuntu marcan el reinicio pendiente con un archivo; en otras distros no se sabe barato.
    "if [ -e /var/run/reboot-required ]; then echo @@reboot=1; elif [ -d /var/lib/dpkg ]; then echo @@reboot=0; fi",
    "echo @@updates; cat /var/lib/update-notifier/updates-available 2>/dev/null",
    // Solo si systemd es el sistema de arranque (en un contenedor systemctl existe pero no responde).
    "if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then echo @@failed; $T systemctl --failed --no-legend --plain --no-pager 2>/dev/null; fi",
    'for c in docker podman; do if command -v $c >/dev/null 2>&1; then echo @@ct=$c; $T $c ps -a --format "{{.Names}}|{{.State}}|{{.Status}}" 2>&1 | head -n 300; fi; done',
  );
  if (users.length) {
    parts.push(`echo @@users; for u in ${users.join(" ")}; do echo "$u:$(id -u $u 2>/dev/null):$(id -Gn $u 2>/dev/null)"; done`);
  }
  // df al final: si un montaje de red se cuelga, lo anterior ya llegó.
  parts.push("echo @@df; $T df -kP 2>/dev/null", "echo @@end");
  return `sh -c '${parts.join("; ")}'`;
}

export interface ContainerSummary {
  engines: string[];
  running: number;
  /** Parados (incluye los caídos). */
  stopped: number;
  /** Parados con error, muertos o reiniciándose sin parar. */
  failed: string[];
  /** No se pudo leer (permiso, demonio parado…) y no hay ningún contenedor. */
  error: string | null;
}

export interface UserInfo {
  name: string;
  exists: boolean;
  root: boolean;
  /** En un grupo que da sudo (wheel, sudo, admin) o root. */
  sudo: boolean;
}

export interface ProbeResult {
  cpu: CpuTicks | null;
  /** % de CPU ya calculado (solo en la ronda con dos lecturas). */
  cpuPct: number | null;
  mem: MemMetrics | null;
  load: [number, number, number] | null;
  nproc: number | null;
  uptimeSecs: number | null;
  hostname: string | null;
  os: string | null;
  disks: DiskUsage[];
  /** null si no se sabe (no es Debian/Ubuntu). */
  rebootRequired: boolean | null;
  updates: number | null;
  /** null = sin systemd. */
  failedUnits: string[] | null;
  containers: ContainerSummary | null;
  users: UserInfo[];
  noProc: boolean;
  /** La salida llegó entera. */
  complete: boolean;
}

const firstInt = (lines: string[] | undefined): number | null => {
  const m = /(\d+)/.exec((lines ?? []).join(" "));
  return m ? Number(m[1]) : null;
};

/** Estado de un contenedor parado: "Exited (0) …" se paró bien; otro código, muerto o reiniciándose, no. */
function isFailed(state: string, status: string): boolean {
  const st = state.toLowerCase();
  if (st === "dead" || st === "restarting") return true;
  const code = /exited\s*\((-?\d+)\)/i.exec(status);
  return !!code && code[1] !== "0";
}

export function parseContainerLines(byEngine: Map<string, string[]>): ContainerSummary | null {
  if (byEngine.size === 0) return null;
  const res: ContainerSummary = { engines: [...byEngine.keys()], running: 0, stopped: 0, failed: [], error: null };
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const lines of byEngine.values()) {
    for (const line of lines) {
      const f = line.trim().split("|");
      if (f.length < 3) {
        errors.push(line.trim());
        continue;
      }
      const [name, state, status] = f;
      // `docker` puede ser el envoltorio de podman: el mismo contenedor dos veces.
      if (seen.has(name)) continue;
      seen.add(name);
      const running = state ? state.toLowerCase() === "running" : /^up\b/i.test(status);
      if (running) res.running++;
      else {
        res.stopped++;
        if (isFailed(state, status)) res.failed.push(name);
      }
    }
  }
  if (seen.size === 0 && errors.length) res.error = errors.slice(0, 2).join(" ");
  return res;
}

export function parseUsers(lines: string[]): UserInfo[] {
  const admin = new Set<string>(ADMIN_GROUPS);
  return lines.map((l) => {
    const [name = "", uid = "", groups = ""] = l.split(":");
    const exists = uid.trim() !== "";
    const root = uid.trim() === "0";
    const sudo = root || groups.trim().split(/\s+/).some((g) => admin.has(g));
    return { name: name.trim(), exists, root, sudo: exists && sudo };
  });
}

export function parseProbe(stdout: string): ProbeResult {
  // El nombre es toda la marca («@@ct=docker», «@@reboot=1»); docker y podman pueden repetir sección.
  const sec = splitSections(stdout, { header: "prefix", blank: "dropBlank", repeat: "append" });
  const get = (k: string) => sec.get(k) ?? [];
  const cpu = parseCpu(get("stat"));
  const cpu2 = sec.has("stat2") ? parseCpu(get("stat2")) : null;
  const containers = new Map<string, string[]>();
  for (const [k, v] of sec) if (k.startsWith("ct=")) containers.set(k.slice(3), v);
  const os = parseOsRelease(get("os")[0] ?? "").PRETTY_NAME ?? null;
  const nproc = firstInt(get("nproc"));
  return {
    cpu: cpu2 ?? cpu,
    cpuPct: cpu2 ? (cpuPercent(cpu, cpu2)?.cpu ?? null) : null,
    mem: memMetrics(parseMeminfo(get("mem"))),
    load: parseLoadavg(get("load"))?.load ?? null,
    nproc: nproc && nproc > 0 ? nproc : null,
    uptimeSecs: get("up").length ? parseUptime(get("up")) : null,
    hostname: get("host")[0]?.trim() || null,
    os: os || null,
    disks: parseDf(get("df")),
    rebootRequired: sec.has("reboot=1") ? true : sec.has("reboot=0") ? false : null,
    updates: firstInt(get("updates")),
    failedUnits: sec.has("failed") ? get("failed").map((l) => l.replace(/^[●*\s]+/, "").split(/\s+/)[0]).filter(Boolean) : null,
    containers: parseContainerLines(containers),
    users: parseUsers(get("users")),
    noProc: sec.has("noproc"),
    complete: sec.has("end"),
  };
}

/** El disco más lleno (el que avisa primero). */
export function fullestDisk(disks: readonly DiskUsage[]): DiskUsage | null {
  let best: DiskUsage | null = null;
  for (const d of disks) if (!best || d.pct > best.pct) best = d;
  return best;
}
