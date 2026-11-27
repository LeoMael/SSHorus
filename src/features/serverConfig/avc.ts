// Denegaciones de SELinux («avc: denied»): leerlas (ausearch, audit.log o el journal), juntar las
// repetidas y explicarlas en simple (qué programa, qué intentó, sobre qué). «Arreglar» solo cuando la
// solución es segura y concreta (un boolean, la etiqueta de un puerto o de una carpeta de la web);
// si no, qué hacer. Funciones puras.
import { shQuote } from "../../lib/remote";
import { booleanChange } from "./selinux";
import { change, row, type ConfigChange, type ConfigRow } from "./model";

export interface AvcDenial {
  /** Segundos desde 1970 (null = no se supo). */
  time: number | null;
  perms: string[];
  comm: string;
  name: string | null;
  path: string | null;
  /** Puerto de destino (connect) y de origen (bind). */
  dest: number | null;
  src: number | null;
  /** Tipo (tercera parte) del contexto del proceso y del objeto. */
  stype: string;
  ttype: string;
  tclass: string;
  permissive: boolean;
}

const typeOf = (ctx: string | undefined) => (ctx ?? "").split(":")[2] ?? "";
const port = (s: string | undefined) => (s && /^\d{1,5}$/.test(s) && Number(s) > 0 && Number(s) < 65536 ? Number(s) : null);

/** Una línea con «avc: denied { … } for …» (de ausearch, audit.log o journalctl -o short-unix). */
export function parseAvcLine(l: string): AvcDenial | null {
  const m = /avc:\s+denied\s+\{([^}]*)\}\s+for\s+(.*)$/.exec(l);
  if (!m) return null;
  const f: Record<string, string> = {};
  for (const kv of m[2].matchAll(/([a-z_]+)=("([^"]*)"|\S+)/g)) f[kv[1]] = kv[3] ?? kv[2];
  const t = /audit\((\d+)(?:\.\d+)?:\d+\)/.exec(l)?.[1] ?? /^(\d{9,})(?:\.\d+)?\s/.exec(l)?.[1];
  if (!f.scontext || !f.tclass) return null;
  return {
    time: t ? Number(t) : null,
    perms: m[1].trim().split(/\s+/).filter(Boolean),
    comm: f.comm ?? "?",
    name: f.name ?? null,
    path: f.path ?? null,
    dest: port(f.dest),
    src: port(f.src),
    stype: typeOf(f.scontext),
    ttype: typeOf(f.tcontext),
    tclass: f.tclass,
    permissive: f.permissive === "1",
  };
}

export interface AvcGroup {
  key: string;
  sample: AvcDenial;
  count: number;
  last: number | null;
  /** Rutas, nombres o puertos distintos que aparecen (los primeros). */
  targets: string[];
}

function targetOf(d: AvcDenial): string | null {
  if (d.dest !== null) return String(d.dest);
  if (d.src !== null) return String(d.src);
  return d.path ?? d.name;
}

/** Junta las repetidas (mismo programa, permiso, clase y etiquetas), de la más reciente a la más vieja. */
export function groupAvc(ls: string[]): AvcGroup[] {
  const by = new Map<string, AvcGroup>();
  for (const l of ls) {
    const d = parseAvcLine(l);
    if (!d) continue;
    const key = [d.stype, d.comm, d.tclass, d.perms.join(","), d.ttype, d.tclass.endsWith("socket") ? (d.dest ?? d.src ?? "") : ""].join("|");
    const g = by.get(key);
    const t = targetOf(d);
    if (!g) by.set(key, { key, sample: d, count: 1, last: d.time, targets: t ? [t] : [] });
    else {
      g.count++;
      if (d.time !== null && (g.last === null || d.time > g.last)) g.last = d.time;
      if (t && !g.targets.includes(t) && g.targets.length < 5) g.targets.push(t);
      if (!g.sample.path && d.path) g.sample = d;
    }
  }
  return [...by.values()].sort((a, b) => (b.last ?? 0) - (a.last ?? 0) || b.count - a.count);
}

// ───────── Explicación ─────────

const WHO: Record<string, string> = {
  httpd_t: "El servidor web",
  container_t: "Un contenedor",
  spc_t: "Un contenedor privilegiado",
  init_t: "systemd",
  sshd_t: "SSH",
  unconfined_t: "Un programa sin restricciones",
  unconfined_service_t: "Un servicio sin restricciones",
  php_fpm_t: "PHP-FPM",
  postgresql_t: "PostgreSQL",
  mysqld_t: "MySQL/MariaDB",
};

const OBJ: Record<string, string> = {
  user_home_t: "un archivo de la carpeta de un usuario",
  user_home_dir_t: "la carpeta de un usuario",
  admin_home_t: "un archivo de la carpeta de root",
  default_t: "algo sin etiqueta conocida (fuera de las carpetas habituales)",
  var_t: "algo de /var sin etiqueta propia",
  tmp_t: "algo de /tmp",
  container_file_t: "archivos de contenedores",
  unreserved_port_t: "un puerto sin uso reservado",
  http_port_t: "un puerto web",
  http_cache_port_t: "un puerto de caché web",
};

const READ = new Set(["read", "open", "getattr", "map", "ioctl", "lock", "search", "execute", "read_file_perms"]);
const isRead = (ps: string[]) => ps.every((p) => READ.has(p));
const quoted = (s: string | null) => (s ? `«${s}»` : "un archivo");

function action(d: AvcDenial): string {
  const ps = d.perms;
  const target = d.path ?? d.name;
  if (d.tclass.endsWith("socket") && ps.includes("name_connect")) return `conectarse al puerto ${d.dest ?? "?"}`;
  if (d.tclass.endsWith("socket") && ps.includes("name_bind")) return `escuchar en el puerto ${d.src ?? "?"}`;
  if (ps.includes("connectto") || d.tclass === "sock_file") return `conectarse al socket ${quoted(target)}`;
  if (d.tclass === "dir") return isRead(ps) ? `entrar en la carpeta ${quoted(target)}` : `crear o borrar archivos en la carpeta ${quoted(target)}`;
  if (d.tclass === "file" || d.tclass === "lnk_file") return isRead(ps) ? `leer ${quoted(target)}` : `escribir en ${quoted(target)}`;
  if (d.tclass.startsWith("capability")) return `usar el permiso de sistema «${ps.join(", ")}»`;
  return `hacer «${ps.join(", ")}» sobre ${d.tclass}${target ? ` ${quoted(target)}` : ""}`;
}

export function explainAvc(g: AvcGroup): string {
  const d = g.sample;
  const who = WHO[d.stype] ?? `El proceso con etiqueta ${d.stype}`;
  const obj = OBJ[d.ttype] ?? `etiqueta ${d.ttype}`;
  const times = g.count > 1 ? ` (${g.count} veces)` : "";
  const perm = d.permissive ? " Se dejó pasar porque está en modo permisivo, pero en Enforcing se bloquearía." : "";
  return `${who} (${d.comm}) no pudo ${action(d)}: ${obj}${times}.${perm}`;
}

// ───────── Qué lo arregla ─────────

/** Etiquetas «sin dueño» que se pueden cambiar a contenido web sin quitarle la protección a nada. */
// Sin tmp_t ni user_tmp_t: una regla permanente para algo de /tmp no tiene sentido.
const UNLABELED = new Set(["default_t", "var_t", "unlabeled_t", "file_t", "usr_t"]);
/** Puertos sin servicio asignado en la política: marcarlos como web no le quita el puerto a nadie. */
const FREE_PORTS = new Set(["unreserved_port_t", "port_t", "hi_reserved_port_t", "reserved_port_t"]);
const DB_PORTS = new Set(["postgresql_port_t", "mysqld_port_t", "mssql_port_t", "oracle_port_t", "mongod_port_t"]);
const SYSTEM_DIRS = ["/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/boot", "/proc", "/sys", "/dev", "/run", "/root"];
const BARE_DIRS = new Set(["/", "/home", "/var", "/opt", "/srv", "/tmp", "/var/lib", "/var/log", "/mnt", "/media", "/data"]);

/** Carpeta segura para etiquetar como contenido web (ruta absoluta, sin «..», fuera del sistema). */
export function webDirFor(d: AvcDenial): string | null {
  const p = d.path;
  if (!p || !/^\/[A-Za-z0-9._@%+=:,/ -]*$/.test(p) || p.split("/").includes("..")) return null;
  const dir = (d.tclass === "dir" ? p : p.slice(0, p.lastIndexOf("/"))).replace(/\/+$/, "") || "/";
  if (BARE_DIRS.has(dir) || SYSTEM_DIRS.some((s) => dir === s || dir.startsWith(`${s}/`))) return null;
  // La carpeta personal entera o algo con «.ssh»: la regla le quitaría a authorized_keys su etiqueta y sshd
  // dejaría de leerla (no se podría entrar con llave).
  if (/^\/home\/[^/]+$/.test(dir) || dir.split("/").includes(".ssh")) return null;
  return dir;
}

const regexOf = (dir: string) => dir.replace(/[.+^$()[\]{}|\\*?]/g, "\\$&");
const SEMANAGE = "command -v semanage >/dev/null 2>&1 || dnf -y install policycoreutils-python-utils";

function labelWebDir(dir: string): ConfigChange {
  return change({
    id: `avc:fcontext:${dir}`,
    label: "Arreglar",
    title: `SELinux: marcar ${dir} como contenido web`,
    explain: `La web podrá leer ${dir} (etiqueta httpd_sys_content_t, que se mantiene aunque se reetiquete el disco).`,
    steps: [
      SEMANAGE,
      `semanage fcontext -a -t httpd_sys_content_t ${shQuote(`${regexOf(dir)}(/.*)?`)} 2>/dev/null || semanage fcontext -m -t httpd_sys_content_t ${shQuote(`${regexOf(dir)}(/.*)?`)}`,
      `restorecon -Rv ${shQuote(dir)}`,
    ],
    timeoutSecs: 600,
  });
}

function labelWebPort(p: number): ConfigChange {
  return change({
    id: `avc:port:${p}`,
    label: "Arreglar",
    title: `SELinux: dejar que la web escuche en el puerto ${p}`,
    explain: `Añade el puerto ${p}/tcp a los puertos web (http_port_t).`,
    // Solo «-a» (puerto sin tipo): «-m» le quitaría el puerto a otro servicio (p. ej. el 22 a sshd).
    steps: [SEMANAGE, `semanage port -a -t http_port_t -p tcp ${p}`],
    timeoutSecs: 600,
  });
}

/** El arreglo seguro (o qué hacer) de un grupo de denegaciones. `bools`: booleans ya activados. */
export function avcRow(g: AvcGroup, bools: Map<string, boolean>): ConfigRow {
  const d = g.sample;
  const base = { id: g.key, title: `${d.comm}: ${action(d)}`, detail: explainAvc(g), status: d.permissive ? ("warn" as const) : ("bad" as const) };
  const bool = (name: string, why: string): ConfigRow =>
    bools.get(name)
      ? row({ ...base, status: "info", advice: `${name} ya está activado: esta denegación es de antes de activarlo.` })
      : row({ ...base, advice: why, change: { ...booleanChange(name, true), id: `avc:${g.key}`, label: "Arreglar" } });
  const web = d.stype === "httpd_t";
  const sock = d.tclass.endsWith("socket");
  if (web && sock && d.perms.includes("name_connect"))
    return DB_PORTS.has(d.ttype)
      ? bool("httpd_can_network_connect_db", "Activa httpd_can_network_connect_db: la web podrá conectarse a bases de datos.")
      : bool("httpd_can_network_connect", "Activa httpd_can_network_connect: la web podrá hacer de proxy hacia otros puertos.");
  if (web && d.tclass === "tcp_socket" && d.perms.includes("name_bind") && d.src !== null && FREE_PORTS.has(d.ttype))
    return row({ ...base, advice: `Marca el puerto ${d.src} como puerto web.`, change: labelWebPort(d.src) });
  if (web && (d.tclass === "file" || d.tclass === "dir" || d.tclass === "lnk_file")) {
    if (!isRead(d.perms))
      return row({
        ...base,
        advice: "La web quiere escribir: si es una carpeta de subidas o caché, etiquétala como httpd_sys_rw_content_t (solo esa carpeta).",
        copy: `semanage fcontext -a -t httpd_sys_rw_content_t '/ruta/de/la/carpeta(/.*)?' && restorecon -Rv /ruta/de/la/carpeta`,
      });
    if (d.ttype === "user_home_dir_t") return bool("httpd_enable_homedirs", "Activa httpd_enable_homedirs: la web podrá entrar en las carpetas de los usuarios.");
    if (d.ttype === "user_home_t") return bool("httpd_read_user_content", "Activa httpd_read_user_content: la web podrá leer archivos de las carpetas de los usuarios.");
    const dir = webDirFor(d);
    if (dir && UNLABELED.has(d.ttype)) return row({ ...base, advice: `Etiqueta ${dir} como contenido web.`, change: labelWebDir(dir) });
    if (UNLABELED.has(d.ttype) && !d.path)
      return row({
        ...base,
        advice: "Etiqueta la carpeta del sitio como contenido web (el registro no dice la ruta completa).",
        copy: `semanage fcontext -a -t httpd_sys_content_t '/ruta/del/sitio(/.*)?' && restorecon -Rv /ruta/del/sitio`,
      });
  }
  if (d.stype === "container_t" && (d.tclass === "file" || d.tclass === "dir" || d.tclass === "lnk_file" || d.tclass === "sock_file"))
    return row({
      ...base,
      advice: "Es un volumen montado sin etiqueta: añade «:Z» al montaje (o «:z» si lo comparten varios contenedores) y vuelve a crear el contenedor.",
      copy: "podman run -v /ruta/en/el/servidor:/ruta/dentro:Z …",
    });
  if (d.stype === "container_t" && sock)
    return row({ ...base, advice: "Si el contenedor de verdad necesita ese puerto del servidor, activa container_connect_any (abre todos los puertos a los contenedores)." });
  return row({
    ...base,
    advice: "No hay un arreglo seguro de un clic. Pega esto en la terminal para ver el motivo y la solución que propone SELinux.",
    copy: `ausearch -m avc -c ${shQuote(d.comm)} -ts yesterday | audit2why`,
  });
}
