// «Qué pueden ver tus usuarios»: script POSIX sh de solo lectura y evaluación pura por usuario sin sudo.
// Comprueba túneles SSH, servicios en 127.0.0.1, /proc (hidepid), configuración web, carpetas HOME ajenas,
// cron/logs y acceso a Docker o contenedores de otros. Reutilizado en Administración → Visibilidad y en Auditoría.
import { splitSections } from "./parse";
import type { PortsResult } from "./ports";

export type VisibilityStatus = "ok" | "warn" | "bad" | "skip";

export type VisibilityArea = "tunnels" | "localServices" | "processes" | "files" | "cronLogs" | "containers";

export interface VisibilityCheck {
  area: VisibilityArea;
  title: string;
  status: VisibilityStatus;
  /** Etiqueta breve para la tabla: «No puede ver», «Puede ver», «Aviso» o «Sin comprobar». */
  verdict: string;
  /** Explicación en lenguaje simple (sin nombres propios ni rutas para poder reutilizarla). */
  detail: string;
  /** Elementos concretos afectados (puertos, rutas, grupos…). */
  items: string[];
  /** Si se puede arreglar con un plan automático (clave para `userVisibilityPlans.ts`). */
  fixable: boolean;
  /** Consejo manual si no tiene arreglo automático. */
  manualHint?: string;
}

export interface UserVisibilityReport {
  user: string;
  uid: number;
  home: string;
  shell: string;
  groups: string[];
  score: number | null;
  grade: string | null;
  exposedCount: number;
  warnCount: number;
  okCount: number;
  checks: VisibilityCheck[];
  /** Datos auxiliares para construir los planes de arreglo del usuario. */
  exposedHomes: string[];
  logGroups: string[];
  inDockerGroup: boolean;
}

export interface LocalServiceInfo {
  port: number;
  ip: string;
  name: string;
  likelyNoAuth: boolean;
  label: string;
}

export interface VisibilityReport {
  elevated: boolean;
  adminUsers: string[];
  adminGroups: string[];
  sshIncludeD: boolean;
  hidepid: boolean | null;
  webDirs: string[];
  webFiles: string[];
  hasCaddyGroup: boolean;
  worldLogs: string[];
  worldCron: string[];
  dockerSock: { path: string; mode: number; group: string; worldOpen: boolean } | null;
  openRuntimeDirs: string[];
  exposedHomesAll: string[];
  localServices: LocalServiceInfo[];
  users: UserVisibilityReport[];
  score: number | null;
  grade: string | null;
  summary: string;
}

export interface SshTunnelCaps {
  tcp: string;
  stream: string;
  x11: string;
  tunnel: string;
  gateway: string;
}

export const NO_LOGIN_SHELL = /(^|\/)(nologin|false|sync|halt|shutdown)$/;

/** Script POSIX sh ligero de solo lectura para evaluar qué ve cada usuario sin sudo. */
export const USER_VISIBILITY_SCRIPT = [
  "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin:/usr/local/bin; export PATH",
  "LC_ALL=C; export LC_ALL",
  "ME=$(id -u)",
  'echo @@id; echo "$ME $(id -un)"',
  "echo @@passwd; cut -d: -f1,3,4,6,7 /etc/passwd 2>/dev/null",
  "echo @@groups; cat /etc/group 2>/dev/null",
  "echo @@sudoers",
  "if [ -r /etc/sudoers ]; then cat /etc/sudoers /etc/sudoers.d/* 2>/dev/null | grep -vE '^[[:space:]]*(#|$)'; elif [ -e /etc/sudoers ]; then echo @noread; fi",
  "if [ -r /etc/doas.conf ]; then sed 's/^/doas: /' /etc/doas.conf | grep -v '^doas: *#'; elif [ -e /etc/doas.conf ]; then echo @noread; fi",
  "echo @@sshinc; grep -ciE '^[[:space:]]*include[[:space:]]+/etc/ssh/sshd_config\\.d' /etc/ssh/sshd_config 2>/dev/null; true",
  "echo @@sshtun",
  "if ! command -v sshd >/dev/null 2>&1; then echo @nosshd",
  "else",
  "  _probe=$(sshd -T 2>/dev/null | head -n1)",
  "  if [ -z \"$_probe\" ]; then echo @noread",
  "  else",
  "    cut -d: -f1,3,7 /etc/passwd 2>/dev/null | while IFS=: read -r u uid shl; do",
  '      { [ "$uid" -ge 1000 ] && [ "$uid" -lt 65534 ]; } 2>/dev/null || continue',
  '      case "$shl" in *nologin|*false|*sync|*halt|*shutdown) continue;; esac',
  '      o=$(sshd -T -C "user=$u,host=localhost,addr=127.0.0.1" 2>/dev/null)',
  '      [ -n "$o" ] || continue',
  "      tcp=$(printf '%s\\n' \"$o\" | awk '$1==\"allowtcpforwarding\"{print $2; exit}')",
  "      str=$(printf '%s\\n' \"$o\" | awk '$1==\"allowstreamlocalforwarding\"{print $2; exit}')",
  "      x11=$(printf '%s\\n' \"$o\" | awk '$1==\"x11forwarding\"{print $2; exit}')",
  "      tun=$(printf '%s\\n' \"$o\" | awk '$1==\"permittunnel\"{print $2; exit}')",
  "      gw=$(printf '%s\\n' \"$o\" | awk '$1==\"gatewayports\"{print $2; exit}')",
  '      echo "$u|$tcp|$str|$x11|$tun|$gw"',
  "    done",
  "  fi",
  "fi",
  "echo @@proc; grep -E '^[^ ]+ /proc proc ' /proc/mounts 2>/dev/null",
  "echo @@homes",
  "cut -d: -f1,3,6,7 /etc/passwd 2>/dev/null | while IFS=: read -r u uid h shl; do",
  '  { [ "$uid" -ge 1000 ] && [ "$uid" -lt 65534 ]; } 2>/dev/null || continue',
  '  [ -d "$h" ] && stat -c "$u|%n|%a|%U|%G" "$h" 2>/dev/null',
  "done",
  "echo @@webperm",
  'for d in /etc/nginx /etc/caddy /etc/apache2 /etc/httpd; do [ -d "$d" ] && { echo "@dir $d"; find "$d" -xdev -type f -perm -0004 2>/dev/null | head -n 40; }; done',
  "getent group caddy >/dev/null 2>&1 && echo '@group caddy'",
  "echo @@cronlogs",
  'for f in /etc/crontab /etc/cron.d/*; do [ -f "$f" ] && [ -n "$(find "$f" -maxdepth 0 -perm -0004 2>/dev/null)" ] && echo "@cron $f"; done',
  'for f in /var/log/auth.log /var/log/secure /var/log/syslog /var/log/messages /var/log/nginx/*.log /var/log/caddy/*.log; do [ -f "$f" ] && [ -n "$(find "$f" -maxdepth 0 -perm -0004 2>/dev/null)" ] && echo "@log $f"; done',
  "echo @@dockersock",
  'for s in /var/run/docker.sock /run/docker.sock; do [ -S "$s" ] && { stat -c "@sock %n|%a|%U|%G" "$s" 2>/dev/null; break; }; done',
  'for d in /tmp/sshorus-run-* /run/user/*; do [ -d "$d" ] && stat -c "@run %n|%a|%U|%G" "$d" 2>/dev/null; done',
  "echo @@end",
].join("\n");

// Servicios internos que a menudo arrancan en 127.0.0.1 sin contraseña por defecto.
const LIKELY_NO_AUTH_PORTS = new Set([6379, 11211, 27017, 9200, 9300, 11434, 9090, 8086, 5984, 8123, 2379, 8500]);
const LIKELY_NO_AUTH_PROCS = /^(redis-server|valkey-server|memcached|mongod|ollama|prometheus|etcd|consul|clickhouse)/i;

/** Clasifica los puertos TCP en 127.0.0.1 / ::1 a los que puede llegar cualquier shell local. */
export function classifyLocalServices(ports: PortsResult | null): LocalServiceInfo[] {
  if (!ports) return [];
  const seen = new Set<string>();
  const out: LocalServiceInfo[] = [];
  for (const p of ports.ports) {
    if (p.proto !== "tcp" || p.scope !== "local") continue;
    const key = `${p.ip}:${p.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const proc = p.container ? `contenedor ${p.container}` : p.unit ?? p.procs[0]?.name ?? "servicio local";
    const rawName = p.procs[0]?.name ?? p.unit ?? "";
    const likelyNoAuth = LIKELY_NO_AUTH_PORTS.has(p.port) || LIKELY_NO_AUTH_PROCS.test(rawName);
    const host = p.ip.includes(":") ? `[${p.ip}]` : p.ip;
    out.push({
      port: p.port,
      ip: p.ip,
      name: proc,
      likelyNoAuth,
      label: `${host}:${p.port} · ${proc}${likelyNoAuth ? " (suele ir sin contraseña)" : ""}`,
    });
  }
  return out.sort((a, b) => Number(b.likelyNoAuth) - Number(a.likelyNoAuth) || a.port - b.port);
}

/** Parsea `@@sshtun` → mapa usuario → opciones efectivas de túneles de sshd. */
export function parseSshTunnels(ls: string[]): { state: "ok" | "noread" | "nosshd"; map: Map<string, SshTunnelCaps> } {
  if (ls.includes("@nosshd")) return { state: "nosshd", map: new Map() };
  if (ls.includes("@noread")) return { state: "noread", map: new Map() };
  const map = new Map<string, SshTunnelCaps>();
  for (const l of ls) {
    const [u, tcp = "", stream = "", x11 = "", tunnel = "", gateway = ""] = l.split("|");
    if (!u || u.startsWith("@")) continue;
    map.set(u, {
      tcp: tcp.toLowerCase(),
      stream: stream.toLowerCase(),
      x11: x11.toLowerCase(),
      tunnel: tunnel.toLowerCase(),
      gateway: gateway.toLowerCase(),
    });
  }
  return { state: "ok", map };
}

/** Qué directivas de túnel siguen activas para un usuario según `sshd -T -C`. */
export function openTunnelFlags(c: SshTunnelCaps): string[] {
  const open: string[] = [];
  if (c.tcp && c.tcp !== "no") open.push(`AllowTcpForwarding ${c.tcp}`);
  if (c.stream && c.stream !== "no") open.push(`AllowStreamLocalForwarding ${c.stream}`);
  if (c.x11 && c.x11 !== "no") open.push(`X11Forwarding ${c.x11}`);
  if (c.tunnel && c.tunnel !== "no") open.push(`PermitTunnel ${c.tunnel}`);
  if (c.gateway && c.gateway !== "no") open.push(`GatewayPorts ${c.gateway}`);
  return open;
}

function gradeOf(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

const AREA_WEIGHT: Record<VisibilityArea, number> = {
  tunnels: 20,
  containers: 20,
  localServices: 15,
  processes: 15,
  files: 15,
  cronLogs: 15,
};

function scoreChecksSimple(checks: VisibilityCheck[]): { score: number | null; grade: string | null } {
  const scored = checks.filter((c) => c.status !== "skip");
  if (!scored.length) return { score: null, grade: null };
  let total = 0;
  let earned = 0;
  for (const c of scored) {
    const w = AREA_WEIGHT[c.area] ?? 15;
    total += w;
    if (c.status === "ok") earned += w;
    else if (c.status === "warn") earned += w * 0.5;
  }
  const score = Math.round((earned / total) * 100);
  return { score, grade: gradeOf(score) };
}

function parseSudoAdmins(groupLines: string[], sudoerLines: string[]): { admins: Set<string>; adminGroups: string[]; groupsByUser: Map<string, Set<string>> } {
  const admins = new Set<string>(["root"]);
  const adminGroups: string[] = [];
  const groupsByUser = new Map<string, Set<string>>();
  const addGroup = (u: string, g: string) => {
    let s = groupsByUser.get(u);
    if (!s) groupsByUser.set(u, (s = new Set()));
    s.add(g);
  };
  for (const l of groupLines) {
    const [gname, , , members = ""] = l.split(":");
    if (!gname) continue;
    const isAdminGrp = gname === "sudo" || gname === "wheel" || gname === "admin";
    if (isAdminGrp) adminGroups.push(gname);
    for (const m of members.split(",")) {
      const u = m.trim();
      if (!u) continue;
      addGroup(u, gname);
      if (isAdminGrp) admins.add(u);
    }
  }
  for (const l of sudoerLines) {
    if (l === "@noread" || l.startsWith("doas:")) continue;
    const m = /^([a-z_][a-z0-9_.-]*)\s+\S+\s*=/i.exec(l.trim());
    if (m && !["Defaults", "root"].includes(m[1]) && !/_Alias$/.test(m[1])) admins.add(m[1]);
  }
  return { admins, adminGroups, groupsByUser };
}

/** Analiza la salida de `USER_VISIBILITY_SCRIPT` + `ports` y produce el informe por usuario sin sudo. */
export function analyzeUserVisibility(stdout: string, ports: PortsResult | null, elevated: boolean): VisibilityReport {
  const sec = splitSections(stdout);
  const idLine = (sec.get("id") ?? [])[0]?.split(" ") ?? [];
  const uid = /^\d+$/.test(idLine[0] ?? "") ? Number(idLine[0]) : null;
  const isElev = elevated || uid === 0;

  const groupLines = sec.get("groups") ?? [];
  const { admins, adminGroups, groupsByUser } = parseSudoAdmins(groupLines, sec.get("sudoers") ?? []);

  // Mapa gid → nombre de grupo primario.
  const gidToName = new Map<number, string>();
  for (const l of groupLines) {
    const [gname, , gidS] = l.split(":");
    if (gname && /^\d+$/.test(gidS ?? "")) gidToName.set(Number(gidS), gname);
  }

  const humans = (sec.get("passwd") ?? [])
    .map((l) => l.split(":"))
    .filter((p) => p.length >= 5 && /^\d+$/.test(p[1]))
    .map((p) => ({ name: p[0], uid: Number(p[1]), gid: Number(p[2]), home: p[3], shell: p[4] }))
    .filter((u) => u.uid >= 1000 && u.uid < 65534 && !NO_LOGIN_SHELL.test(u.shell));

  const nonAdmins = humans.filter((u) => !admins.has(u.name));
  const sshIncludeD = Number((sec.get("sshinc") ?? [])[0] ?? "0") > 0;
  const tunnels = parseSshTunnels(sec.get("sshtun") ?? []);

  const procLine = (sec.get("proc") ?? [])[0] ?? "";
  const hidepid = procLine ? /hidepid=(1|2|noaccess|invisible)/.test(procLine) : null;

  const homes = (sec.get("homes") ?? [])
    .map((l) => l.split("|"))
    .filter((p) => p.length >= 5 && /^[0-7]{3,4}$/.test(p[2]))
    .map((p) => ({ user: p[0], path: p[1], mode: Number.parseInt(p[2], 8), owner: p[3], group: p[4] }));

  const webPerm = sec.get("webperm") ?? [];
  const webDirs = webPerm.filter((l) => l.startsWith("@dir ")).map((l) => l.slice(5));
  const webFiles = webPerm.filter((l) => !l.startsWith("@"));
  const hasCaddyGroup = webPerm.includes("@group caddy");

  const cronLogs = sec.get("cronlogs") ?? [];
  const worldCron = cronLogs.filter((l) => l.startsWith("@cron ")).map((l) => l.slice(6));
  const worldLogs = cronLogs.filter((l) => l.startsWith("@log ")).map((l) => l.slice(5));

  let dockerSock: VisibilityReport["dockerSock"] = null;
  const openRuntimeDirs: string[] = [];
  for (const l of sec.get("dockersock") ?? []) {
    if (l.startsWith("@sock ")) {
      const [path, modeS, , group = ""] = l.slice(6).split("|");
      const mode = Number.parseInt(modeS ?? "", 8);
      if (path && Number.isFinite(mode)) dockerSock = { path, mode, group, worldOpen: (mode & 0o006) !== 0 };
    } else if (l.startsWith("@run ")) {
      const [path, modeS] = l.slice(5).split("|");
      const mode = Number.parseInt(modeS ?? "", 8);
      if (path && Number.isFinite(mode) && (mode & 0o005) !== 0) openRuntimeDirs.push(path);
    }
  }

  const localServices = classifyLocalServices(ports);
  const likelyNoAuth = localServices.filter((s) => s.likelyNoAuth);
  const exposedHomesAll = homes.filter((h) => (h.mode & 0o005) !== 0).map((h) => h.path);

  const users: UserVisibilityReport[] = nonAdmins.map((u) => {
    const uGroups = new Set<string>(groupsByUser.get(u.name) ?? []);
    const primary = gidToName.get(u.gid);
    if (primary) uGroups.add(primary);
    const groups = [...uGroups].sort();
    const checks: VisibilityCheck[] = [];

    // 1. Túneles SSH
    if (tunnels.state === "nosshd") {
      checks.push({ area: "tunnels", title: "Túneles SSH", status: "ok", verdict: "No puede ver", detail: "No hay servidor sshd instalado.", items: [], fixable: false });
    } else if (tunnels.state === "noread" || !tunnels.map.has(u.name)) {
      checks.push({ area: "tunnels", title: "Túneles SSH", status: "skip", verdict: "Sin comprobar", detail: "Necesita sudo para consultar «sshd -T -C».", items: [], fixable: false });
    } else {
      const open = openTunnelFlags(tunnels.map.get(u.name)!);
      checks.push(
        open.length
          ? {
              area: "tunnels",
              title: "Túneles SSH",
              status: "bad",
              verdict: "Puede ver",
              detail: "Puede abrir túneles SSH y llegar desde su PC a servicios en 127.0.0.1.",
              items: open,
              fixable: true,
            }
          : {
              area: "tunnels",
              title: "Túneles SSH",
              status: "ok",
              verdict: "No puede ver",
              detail: "Tiene los túneles SSH y reenvíos desactivados.",
              items: [],
              fixable: false,
            },
      );
    }

    // 2. Servicios internos en 127.0.0.1
    if (!ports) {
      checks.push({ area: "localServices", title: "Servicios internos (127.0.0.1)", status: "skip", verdict: "Sin comprobar", detail: "No se pudieron leer los puertos locales.", items: [], fixable: false });
    } else if (likelyNoAuth.length > 0) {
      checks.push({
        area: "localServices",
        title: "Servicios internos (127.0.0.1)",
        status: "bad",
        verdict: "Puede ver",
        detail: "Desde su shell puede conectarse a servicios locales que suelen no pedir contraseña.",
        items: localServices.map((s) => s.label),
        fixable: false,
        manualHint: "Activa contraseña o autenticación en estos servicios, o pásalos a un socket Unix con permisos de grupo.",
      });
    } else if (localServices.length > 0) {
      checks.push({
        area: "localServices",
        title: "Servicios internos (127.0.0.1)",
        status: "warn",
        verdict: "Aviso",
        detail: "Puede alcanzar puertos internos desde su shell (curl, psql…); comprueba que pidan contraseña.",
        items: localServices.map((s) => s.label),
        fixable: false,
        manualHint: "Asegúrate de que cada servicio en 127.0.0.1 pida autenticación o restríngelo a su propio usuario.",
      });
    } else {
      checks.push({ area: "localServices", title: "Servicios internos (127.0.0.1)", status: "ok", verdict: "No puede ver", detail: "No hay servicios escuchando en 127.0.0.1.", items: [], fixable: false });
    }

    // 3. Procesos ajenos (/proc sin hidepid)
    if (hidepid === null) {
      checks.push({ area: "processes", title: "Procesos de otros usuarios", status: "skip", verdict: "Sin comprobar", detail: "No se pudo leer /proc/mounts.", items: [], fixable: false });
    } else if (!hidepid) {
      checks.push({
        area: "processes",
        title: "Procesos de otros usuarios",
        status: "bad",
        verdict: "Puede ver",
        detail: "Ve los procesos y comandos de todos los usuarios (/proc sin hidepid).",
        items: ["/proc montado sin hidepid=2"],
        fixable: true,
      });
    } else {
      checks.push({ area: "processes", title: "Procesos de otros usuarios", status: "ok", verdict: "No puede ver", detail: "/proc tiene hidepid activado.", items: [], fixable: false });
    }

    // 4. Carpetas HOME ajenas y configuración web
    const otherOpenHomes = homes.filter((h) => h.user !== u.name && ((h.mode & 0o005) !== 0 || (uGroups.has(h.group) && (h.mode & 0o050) !== 0)));
    const fileItems = [
      ...otherOpenHomes.map((h) => `${h.path} (permisos ${h.mode.toString(8)})`),
      ...webFiles.slice(0, 12),
    ];
    const hasWebKeys = webFiles.some((f) => /(\.key|privkey[^/]*)$/.test(f));
    if (otherOpenHomes.length || webFiles.length) {
      checks.push({
        area: "files",
        title: "Carpetas HOME y configuración web",
        status: hasWebKeys || otherOpenHomes.length > 0 ? "bad" : "warn",
        verdict: hasWebKeys || otherOpenHomes.length > 0 ? "Puede ver" : "Aviso",
        detail: [
          otherOpenHomes.length ? `Puede entrar en ${otherOpenHomes.length} carpeta${otherOpenHomes.length === 1 ? "" : "s"} HOME ajena${otherOpenHomes.length === 1 ? "" : "s"}` : "",
          webFiles.length ? `lee archivos de configuración web (${webDirs.join(", ")})` : "",
        ]
          .filter(Boolean)
          .join(" y ") + ".",
        items: fileItems,
        fixable: true,
      });
    } else {
      checks.push({ area: "files", title: "Carpetas HOME y configuración web", status: "ok", verdict: "No puede ver", detail: "Las carpetas HOME ajenas y la configuración web están protegidas.", items: [], fixable: false });
    }

    // 5. Cron y registros (logs)
    const logGroups = groups.filter((g) => g === "adm" || g === "systemd-journal");
    const cronLogItems = [...logGroups.map((g) => `grupo ${g}`), ...worldLogs, ...worldCron];
    if (logGroups.length || worldLogs.length || worldCron.length) {
      checks.push({
        area: "cronLogs",
        title: "Registros (logs) y cron",
        status: logGroups.length || worldLogs.length ? "bad" : "warn",
        verdict: logGroups.length || worldLogs.length ? "Puede ver" : "Aviso",
        detail: [
          logGroups.length ? `Pertenece a ${logGroups.join(", ")} (lee registros del sistema)` : "",
          worldLogs.length ? `${worldLogs.length} archivo${worldLogs.length === 1 ? "" : "s"} de log legible${worldLogs.length === 1 ? "" : "s"} por todos` : "",
          worldCron.length ? `${worldCron.length} archivo${worldCron.length === 1 ? "" : "s"} de cron legible${worldCron.length === 1 ? "" : "s"} por todos` : "",
        ]
          .filter(Boolean)
          .join(" · ") + ".",
        items: cronLogItems,
        fixable: true,
      });
    } else {
      checks.push({ area: "cronLogs", title: "Registros (logs) y cron", status: "ok", verdict: "No puede ver", detail: "No tiene acceso a los registros del sistema ni a cron ajenos.", items: [], fixable: false });
    }

    // 6. Contenedores de otros y Docker
    const inDockerGroup = uGroups.has("docker");
    const otherOpenRun = openRuntimeDirs.filter((d) => !d.endsWith(`-${u.uid}`) && !d.endsWith(`/${u.uid}`));
    const ctrItems = [
      ...(inDockerGroup ? ["grupo docker (acceso equivalente a root)"] : []),
      ...(dockerSock?.worldOpen ? [`${dockerSock.path} (permisos ${dockerSock.mode.toString(8)})`] : []),
      ...otherOpenRun.map((d) => `${d} (carpeta de contenedores abierta a otros)`),
    ];
    if (ctrItems.length) {
      checks.push({
        area: "containers",
        title: "Contenedores de otros y Docker",
        status: "bad",
        verdict: "Puede ver",
        detail: inDockerGroup || dockerSock?.worldOpen
          ? "Tiene acceso al socket de Docker (puede escalar a root y controlar todos los contenedores)."
          : "Hay carpetas de contenedores de otros usuarios con permisos abiertos.",
        items: ctrItems,
        fixable: true,
      });
    } else {
      checks.push({ area: "containers", title: "Contenedores de otros y Docker", status: "ok", verdict: "No puede ver", detail: "No llega al socket de Docker ni a contenedores de otros usuarios.", items: [], fixable: false });
    }

    const { score, grade } = scoreChecksSimple(checks);
    return {
      user: u.name,
      uid: u.uid,
      home: u.home,
      shell: u.shell,
      groups,
      score,
      grade,
      exposedCount: checks.filter((c) => c.status === "bad").length,
      warnCount: checks.filter((c) => c.status === "warn").length,
      okCount: checks.filter((c) => c.status === "ok").length,
      checks,
      exposedHomes: otherOpenHomes.map((h) => h.path),
      logGroups,
      inDockerGroup,
    };
  });

  const userScores = users.map((u) => u.score).filter((x): x is number => x !== null);
  const score = userScores.length ? Math.round(userScores.reduce((a, b) => a + b, 0) / userScores.length) : null;
  const grade = score !== null ? gradeOf(score) : null;
  const exposedUsers = users.filter((u) => u.exposedCount > 0).length;
  const summary = !users.length
    ? "No hay usuarios humanos sin sudo en este servidor."
    : exposedUsers > 0
      ? `${exposedUsers} de ${users.length} usuario${users.length === 1 ? "" : "s"} sin sudo puede${exposedUsers === 1 ? "" : "n"} ver o alcanzar recursos ajenos.`
      : `Los ${users.length} usuario${users.length === 1 ? "" : "s"} sin sudo están bien aislados.`;

  return {
    elevated: isElev,
    adminUsers: [...admins].sort(),
    adminGroups,
    sshIncludeD,
    hidepid,
    webDirs,
    webFiles,
    hasCaddyGroup,
    worldLogs,
    worldCron,
    dockerSock,
    openRuntimeDirs,
    exposedHomesAll,
    localServices,
    users,
    score,
    grade,
    summary,
  };
}
