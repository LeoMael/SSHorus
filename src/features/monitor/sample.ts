// Muestreo del servidor: comando POSIX + parseo de su salida (funciones puras, sin React ni Tauri).
//
// Reglas del script (mismas que en privileges/detect.ts):
// - va entre comillas simples para el shell de login (bash, zsh, fish, tcsh…): dentro NO puede haber
//   comillas simples, barras invertidas ni "!";
// - solo lee: /proc, df, id, getconf, stat. Nada se instala ni se escribe en el servidor;
// - salida en secciones que empiezan con una línea "@@nombre"; quien la lee ignora lo que no conoce.
//
// Procesos: en vez de `ps --sort=-pcpu` (su %CPU es la media desde que arrancó el proceso, no el
// consumo actual, y busybox no lo admite) se leen los contadores de /proc/[pid]/stat y el % se
// calcula por diferencia entre dos muestras, igual que `top`. Funciona igual en GNU y en busybox.
import { splitSections } from "../../lib/remote";
import { parseDf } from "./disks";
import type { CpuTicks, MemInfo, NetCounter, ProcStat, RawSample, SampleInfo } from "./sampleTypes";

export { parseDf };

export type { CpuTicks, DiskUsage, MemInfo, NetCounter, ProcStat, RawSample, SampleInfo } from "./sampleTypes";

/** Tiempo límite de cada muestreo (s). */
export const SAMPLE_TIMEOUT_SECS = 12;

export interface SampleCommandOptions {
  /** Incluir datos que casi no cambian (CPU, usuario, tamaños, herramientas, /etc/passwd). */
  full: boolean;
  /** pids cuyo dueño (uid) hay que averiguar. */
  uidPids?: number[];
  /** El dueño de todos los procesos (la primera vez, o si hay muchos nuevos). */
  uidAll?: boolean;
  /** Partes de script de otros módulos (mismas reglas de comillas), antes de `df`. */
  extra?: string[];
}

/** Más pids nuevos que esto: se pregunta el dueño de todos (la lista no cabe en el comando). */
const MAX_UID_PIDS = 64;

/** Comando exacto que se envía por el canal exec. */
export function buildSampleCommand(opts: SampleCommandOptions): string {
  const parts: string[] = [
    "echo @@begin",
    // pid de este shell: sus hijos (cut, grep, df…) no son procesos del servidor.
    'echo "@@self=$$"',
    'if [ -r /proc/stat ]; then :; else echo @@noproc; fi',
    'echo @@stat; grep "^cpu " /proc/stat 2>/dev/null',
    "echo @@mem; cat /proc/meminfo 2>/dev/null",
    "echo @@load; cat /proc/loadavg 2>/dev/null",
    "echo @@up; cat /proc/uptime 2>/dev/null",
    "echo @@net; cat /proc/net/dev 2>/dev/null",
  ];
  if (opts.full) {
    parts.push(
      "echo @@info",
      'echo "nproc=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null)"',
      'echo "user=$(id -un 2>/dev/null)"',
      'echo "uid=$(id -u 2>/dev/null)"',
      'echo "page=$(getconf PAGESIZE 2>/dev/null)"',
      'echo "hz=$(getconf CLK_TCK 2>/dev/null)"',
      'if command -v docker >/dev/null 2>&1; then echo docker=1; fi',
      'if command -v podman >/dev/null 2>&1; then echo podman=1; fi',
      'echo "hidepid=$(grep " /proc proc " /proc/mounts 2>/dev/null | head -n 1 | grep -o "hidepid=[a-z0-9]*" | cut -d= -f2)"',
      "echo @@passwd; cut -d: -f1,3 /etc/passwd 2>/dev/null",
      // Rangos de uid de los contenedores de Podman sin root (lo puede leer cualquiera).
      "echo @@subuid; cat /etc/subuid 2>/dev/null",
    );
  }
  parts.push(
    // Procesos: pid (comm) estado ppid utime stime arranque rss. Sin hilos del kernel (padre = 2).
    'echo @@ps; cut -d" " -f1,2,3,4,14,15,22,24 /proc/[0-9]*/stat 2>/dev/null | grep -v ") . 2 "',
    // Los que tienen espacios en el nombre (p. ej. "tmux: server") descuadran cut: van completos.
    'echo @@psx; grep -h "(.* .*)" /proc/[0-9]*/stat 2>/dev/null',
  );
  const pids = (opts.uidPids ?? []).filter((p) => Number.isInteger(p) && p > 0);
  if (opts.uidAll || pids.length) {
    const paths = opts.uidAll || pids.length > MAX_UID_PIDS ? "/proc/[0-9]*" : pids.map((p) => `/proc/${p}`).join(" ");
    parts.push(
      `echo @@uid; if command -v stat >/dev/null 2>&1; then stat -c "%u %n" ${paths} 2>/dev/null; else ls -lnd ${paths} 2>/dev/null; fi`,
    );
  }
  parts.push(...(opts.extra ?? []));
  // df al final: si un montaje de red se cuelga, lo anterior ya llegó.
  parts.push("echo @@df; df -kP 2>/dev/null", "echo @@end");
  return `sh -c '${parts.join("; ")}'`;
}

const num = (s: string | undefined): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

function sectionValues(stdout: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of stdout.split("\n")) {
    const m = /^@@([a-z]+)=(.*)$/.exec(raw.replace(/\r$/, ""));
    if (m) out.set(m[1], m[2].trim());
  }
  return out;
}

export function parseCpu(lines: string[]): CpuTicks | null {
  const line = lines.find((l) => /^cpu\s/.test(l));
  if (!line) return null;
  const f = line.trim().split(/\s+/).slice(1).map(Number);
  if (f.length < 4 || f.some((x) => !Number.isFinite(x))) return null;
  // user nice system idle iowait irq softirq steal guest guest_nice. guest ya está dentro de user.
  const [user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = f;
  const total = user + nice + system + idle + iowait + irq + softirq + steal;
  return { total, idle: idle + iowait, iowait, steal };
}

export function parseMeminfo(lines: string[]): MemInfo | null {
  const kv = new Map<string, number>();
  for (const l of lines) {
    const m = /^([A-Za-z0-9_()]+):\s+(\d+)/.exec(l);
    if (m) kv.set(m[1], Number(m[2]));
  }
  const total = kv.get("MemTotal");
  if (!total) return null;
  const free = kv.get("MemFree") ?? 0;
  const buffers = kv.get("Buffers") ?? 0;
  const cached = (kv.get("Cached") ?? 0) + (kv.get("SReclaimable") ?? 0);
  const available = kv.get("MemAvailable") ?? Math.min(total, free + buffers + cached);
  return {
    totalKb: total,
    availableKb: available,
    freeKb: free,
    buffersKb: buffers,
    cachedKb: cached,
    swapTotalKb: kv.get("SwapTotal") ?? 0,
    swapFreeKb: kv.get("SwapFree") ?? 0,
  };
}

export function parseLoadavg(lines: string[]): { load: [number, number, number]; tasks: RawSample["tasks"] } | null {
  const f = (lines[0] ?? "").trim().split(/\s+/);
  const load: [number, number, number] = [num(f[0]), num(f[1]), num(f[2])];
  if (load.some((x) => Number.isNaN(x))) return null;
  const t = /^(\d+)\/(\d+)$/.exec(f[3] ?? "");
  return { load, tasks: t ? { running: Number(t[1]), total: Number(t[2]) } : null };
}

export function parseUptime(lines: string[]): number | null {
  const v = num((lines[0] ?? "").trim().split(/\s+/)[0]);
  return Number.isNaN(v) ? null : v;
}

export function parseNetDev(lines: string[]): NetCounter[] {
  const out: NetCounter[] = [];
  for (const l of lines) {
    const i = l.indexOf(":");
    if (i < 0) continue;
    const iface = l.slice(0, i).trim();
    if (!iface || iface.includes("|")) continue;
    const f = l.slice(i + 1).trim().split(/\s+/);
    const rx = num(f[0]);
    const tx = num(f[8]);
    if (Number.isNaN(rx) || Number.isNaN(tx)) continue;
    out.push({ iface, rx, tx });
  }
  return out;
}

/** Línea completa de /proc/[pid]/stat (el nombre puede tener espacios y paréntesis). */
export function parseProcStatLine(line: string): ProcStat | null {
  const open = line.indexOf(" (");
  const close = line.lastIndexOf(") ");
  if (open < 0 || close < open) return null;
  const pid = Number(line.slice(0, open));
  const comm = line.slice(open + 2, close);
  const f = line.slice(close + 2).trim().split(/\s+/);
  // f[0] = estado (campo 3); utime = campo 14 → f[11]; stime f[12]; starttime f[19]; rss f[21].
  const ticks = num(f[11]) + num(f[12]);
  if (!Number.isInteger(pid) || Number.isNaN(ticks)) return null;
  const rss = num(f[21]);
  return { pid, ppid: num(f[1]), comm, state: f[0] ?? "?", ticks, start: num(f[19]), rssPages: Number.isNaN(rss) ? null : rss };
}

/** Líneas de `cut -f1,2,3,4,14,15,22,24`: pid (comm) estado ppid utime stime arranque rss. */
export function parseProcCutLine(line: string): ProcStat | null {
  const f = line.trim().split(" ");
  if (f.length < 8) return null;
  if (!f[1].startsWith("(") || !f[1].endsWith(")")) return null; // nombre con espacios: viene en @@psx
  const pid = Number(f[0]);
  const ticks = num(f[4]) + num(f[5]);
  if (!Number.isInteger(pid) || Number.isNaN(ticks)) return null;
  const rss = num(f[7]);
  return {
    pid,
    ppid: num(f[3]),
    comm: f[1].slice(1, -1),
    state: f[2],
    ticks,
    start: num(f[6]),
    rssPages: Number.isNaN(rss) ? null : rss,
  };
}

function parseInfo(lines: string[]): SampleInfo {
  const kv = new Map<string, string>();
  for (const l of lines) {
    const m = /^([a-z]+)=(.*)$/.exec(l);
    if (m) kv.set(m[1], m[2].trim());
  }
  const pos = (k: string) => {
    const v = Number(kv.get(k));
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const uid = Number(kv.get("uid"));
  return {
    nproc: pos("nproc"),
    user: kv.get("user") || null,
    uid: kv.get("uid") !== undefined && kv.get("uid") !== "" && Number.isInteger(uid) ? uid : null,
    pageSize: pos("page"),
    hz: pos("hz"),
    docker: kv.get("docker") === "1",
    podman: kv.get("podman") === "1",
    hidepid: /^(1|2|invisible|noaccess)$/.test(kv.get("hidepid") ?? ""),
  };
}

/** `stat -c "%u %n"` → "1000 /proc/123"; o `ls -lnd` → "dr-xr-xr-x 9 1000 1000 0 … /proc/123". */
function parseUids(lines: string[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const l of lines) {
    let m = /^(\d+)\s+\/proc\/(\d+)$/.exec(l.trim());
    if (m) {
      out.set(Number(m[2]), Number(m[1]));
      continue;
    }
    m = /^\S+\s+\d+\s+(\d+)\s+\d+\s.*\/proc\/(\d+)$/.exec(l.trim());
    if (m) out.set(Number(m[2]), Number(m[1]));
  }
  return out;
}

function parsePasswd(lines: string[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const l of lines) {
    const [name, id] = l.split(":");
    const uid = Number(id);
    if (name && Number.isInteger(uid) && !out.has(uid)) out.set(uid, name);
  }
  return out;
}

/** Lo que lanza el propio muestreo (con sudo, el `sudo` y el `sh` que lo envuelven): no son del servidor. */
const WRAPPER = /^(sh|dash|sudo|doas|cat)$/;

function dropOwnProcesses(procs: Map<number, ProcStat>, self: number): void {
  const own = new Set([self]);
  for (let p = procs.get(self); p && procs.get(p.ppid) && WRAPPER.test(procs.get(p.ppid)!.comm); p = procs.get(p.ppid)) {
    own.add(p.ppid);
  }
  for (const p of [...procs.values()]) if (own.has(p.pid) || own.has(p.ppid)) procs.delete(p.pid);
}

export function parseSample(stdout: string, at = Date.now()): RawSample {
  // Marcas «@@nombre» o «@@nombre=valor» (el valor se lee aparte, con sectionValues).
  const s = splitSections(stdout, { header: "key", blank: "dropBlank" });
  const get = (k: string) => s.get(k) ?? [];
  const procs = new Map<number, ProcStat>();
  for (const l of get("ps")) {
    const p = parseProcCutLine(l);
    if (p) procs.set(p.pid, p);
  }
  for (const l of get("psx")) {
    const p = parseProcStatLine(l);
    if (p && p.ppid !== 2) procs.set(p.pid, p);
  }
  const selfPid = Number(sectionValues(stdout).get("self"));
  const self = Number.isInteger(selfPid) && selfPid > 0 ? selfPid : null;
  if (self !== null) dropOwnProcesses(procs, self);
  const la = parseLoadavg(get("load"));
  return {
    at,
    uptime: parseUptime(get("up")),
    cpu: parseCpu(get("stat")),
    mem: parseMeminfo(get("mem")),
    load: la?.load ?? null,
    tasks: la?.tasks ?? null,
    net: parseNetDev(get("net")),
    disks: parseDf(get("df")),
    procs: [...procs.values()],
    uids: parseUids(get("uid")),
    users: parsePasswd(get("passwd")),
    info: s.has("info") ? parseInfo(get("info")) : null,
    complete: s.has("end"),
    noProc: s.has("noproc"),
    selfPid: self,
    sections: s,
  };
}
