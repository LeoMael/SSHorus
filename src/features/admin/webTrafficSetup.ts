// Scripts para poner o quitar el registro de visitas propio de un sitio (Caddy o nginx), paso a paso:
// revisar, copia de respaldo, carpeta (dueño y SELinux), editar, validar, recargar y una visita de
// prueba. Si algo falla (o se cancela) antes de recargar bien, el archivo vuelve a quedar como estaba.
// El script avisa de cada paso con «@@paso <clave>» (lo lee webLogResult.ts). Funciones puras.
import { shQuote } from "../../lib/remote";
import { reloadSteps, type ServerInfo, type Site } from "./web";
import { PY_LOG_PATCH } from "./webLogPatch";

export const TRAFFIC_LOG_MARK = "# sshorus-traffic-log";
/** Donde quedan las copias del archivo antes de cada cambio (no las lee nginx ni Caddy). */
export const LOG_BACKUP_DIR = "/var/backups/sshorus";
/** Agente de la visita de prueba (el filtro «Sin bots» la quita de las cifras). */
export const PROBE_AGENT = "SSHorus-prueba-del-registro";

export type LogAction = "enable" | "disable";
export type LogStepKey = "check" | "backup" | "folder" | "edit" | "validate" | "reload" | "verify";

const STEP_LABEL: Record<LogStepKey, string> = {
  check: "Revisar la configuración",
  backup: "Copia de respaldo",
  folder: "Preparar la carpeta del registro",
  edit: "Editar el sitio",
  validate: "Validar la configuración",
  reload: "Recargar sin cortar conexiones",
  verify: "Comprobar con una visita de prueba",
};

const STEPS: Record<LogAction, LogStepKey[]> = {
  enable: ["check", "backup", "folder", "edit", "validate", "reload", "verify"],
  disable: ["check", "backup", "edit", "validate", "reload"],
};

export interface SiteLogPlan {
  action: LogAction;
  title: string;
  logPath: string;
  steps: { key: LogStepKey; label: string }[];
  /** Script completo (se enseña antes de ejecutarlo). */
  script: string;
  /** El mismo script sin el parche en Python (para el historial). */
  brief: string;
}

/** Convierte un dominio o clave de sitio en un nombre de archivo seguro (`[a-z0-9._-]`). */
export function siteLogSlug(site: Pick<Site, "names" | "server" | "key">): string {
  const base = (site.names[0] ?? `${site.server}-default`)
    .toLowerCase()
    .replace(/^\*\./, "wildcard-")
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 64);
  return base || `${site.server}-site`;
}

/** Ruta donde SSHorus guarda el registro del sitio: en la carpeta de logs del servidor web (SELinux ya la conoce). */
export function suggestedLogPath(site: Pick<Site, "names" | "server" | "key">): string {
  const slug = siteLogSlug(site);
  return site.server === "caddy" ? `/var/log/caddy/${slug}.log` : `/var/log/nginx/${slug}.access.log`;
}

const logDir = (log: string) => log.replace(/\/[^/]+$/, "") || "/";

/** El registro del sitio es el que pone SSHorus (y por tanto se puede quitar desde aquí). */
export function isSshorusLog(site: Site): boolean {
  return !!site.accessLog?.path && site.accessLog.path === suggestedLogPath(site);
}

/**
 * Qué se le pasa al parche: Caddy busca el bloque por dominio (y su puerto, por si el mismo dominio tiene
 * otro bloque: el «http://…» que redirige o «dominio:8443»); nginx, por archivo y línea.
 */
function patchTarget(server: ServerInfo, site: Site): { where: string; target: string } | null {
  if (site.server === "caddy") {
    const host = site.names[0];
    const port = site.listens[0]?.port;
    return host ? { where: server.configPath, target: port ? `${host}|${port}` : host } : null;
  }
  return site.file && site.line ? { where: site.file, target: String(site.line) } : null;
}

/** Visita de prueba al propio sitio (por 127.0.0.1 con su dominio), con curl o wget. */
export function probeCommand(site: Site): string {
  const host = site.names.find((n) => n && !n.includes("*")) ?? "localhost";
  const listen = site.listens.find((l) => !l.https && l.port > 0) ?? site.listens.find((l) => l.port > 0);
  const https = listen ? listen.https : site.https;
  const port = listen?.port ?? (https ? 443 : 80);
  const raw = listen?.host && listen.host !== "*" ? listen.host : "127.0.0.1";
  const addr = raw.includes(":") ? `[${raw}]` : raw;
  const scheme = https ? "https" : "http";
  const url = `${scheme}://${host}:${port}/`;
  return [
    "if command -v curl >/dev/null 2>&1; then",
    `  curl -sk -o /dev/null -m 5 -A ${PROBE_AGENT} --resolve ${shQuote(`${host}:${port}:${addr}`)} ${shQuote(url)} || true`,
    "elif command -v wget >/dev/null 2>&1; then",
    `  wget -q -O /dev/null -T 5 --no-check-certificate -U ${PROBE_AGENT} --header ${shQuote(`Host: ${host}`)} ${shQuote(`${scheme}://${addr}:${port}/`)} || true`,
    "else echo '@@verifica sin-cliente'; exit 0; fi",
  ].join("\n");
}

/** Dueño de la carpeta y del archivo (Caddy escribe como su usuario; nginx abre los logs como root). */
function ownerSteps(site: Site, rawDir: string, rawLog: string): string[] {
  if (site.server !== "caddy") return [];
  const [dir, log] = [shQuote(rawDir), shQuote(rawLog)];
  return [
    "u=$(ps -o user= -C caddy 2>/dev/null | tr -d ' ' | grep -v '^root$' | head -n1)",
    '[ -n "$u" ] || { id caddy >/dev/null 2>&1 && u=caddy; }',
    'if [ -n "$u" ]; then',
    // `caddy validate` (como root) crearía el archivo con dueño root y permisos 600: Caddy, que corre
    // como su usuario, no podría abrirlo al recargar. Por eso se crea antes con el dueño correcto.
    `  chown "$u": ${dir} && { [ -e ${log} ] || : > ${log}; } && chown "$u": ${log} && chmod 640 ${log} || falla folder`,
    `  echo "La carpeta ${rawDir} y el registro son del usuario $u (con el que corre Caddy)."`,
    "fi",
  ];
}

/** Con SELinux, el servidor web (httpd_t) solo escribe en carpetas con contexto httpd_log_t. */
function selinuxSteps(site: Site, rawDir: string): string[] {
  const dir = shQuote(rawDir);
  const pattern = shQuote(`${rawDir}(/.*)?`);
  return [
    "if selinux_on; then",
    `  restorecon -R ${dir} 2>/dev/null`,
    `  dom=$(ps -eo label=,comm= 2>/dev/null | awk '$2=="${site.server}" {split($1,a,":"); print a[3]; exit}')`,
    `  t=$(stat -c %C ${dir} 2>/dev/null | cut -d: -f3)`,
    `  echo "SELinux activo: ${site.server} corre como \${dom:-desconocido} y ${rawDir} tiene \${t:-desconocido}."`,
    '  if [ "$dom" = httpd_t ] && [ "$t" != httpd_log_t ]; then',
    "    if command -v semanage >/dev/null 2>&1; then",
    `      { semanage fcontext -a -t httpd_log_t ${pattern} 2>/dev/null || semanage fcontext -m -t httpd_log_t ${pattern}; } && restorecon -R ${dir} || falla selinux`,
    `    else chcon -R -t httpd_log_t ${dir} || falla selinux; fi`,
    `    echo "Contexto SELinux de ${rawDir}: httpd_log_t (para que ${site.server} pueda escribir)."`,
    "  fi",
    "fi",
  ];
}

interface StepCtx {
  action: LogAction;
  server: ServerInfo;
  site: Site;
  log: string;
  /** Argumentos del parche (ya citados). */
  args: string;
}

function stepScript(key: LogStepKey, { action, server, site, log, args }: StepCtx): string[] {
  const dir = shQuote(logDir(log));
  const q = shQuote(log);
  const [validate, reload] = reloadSteps(server);
  switch (key) {
    case "check":
      return [
        "command -v python3 >/dev/null 2>&1 || falla python",
        "b=$(mktemp -d) || falla tmp",
        "edited=; installed=; reloaded=",
        // Si algo falla o se cancela después de editar y antes de recargar bien, el archivo vuelve a
        // estar como antes. Sin SIGPIPE: al cancelar, el canal puede cerrarse antes de restaurar.
        `trap 'if [ -n "$installed" ] && [ -z "$reloaded" ]; then cat "$b/orig" > "$edited" && echo "Se dejó $edited como estaba."; fi; rm -rf "$b"' EXIT`,
        "trap 'exit 130' TERM INT HUP; trap '' PIPE",
        // Si la configuración ya tenía un error, se dice así (y no se toca nada).
        `${validate} > "$b/pre" 2>&1 || { cat "$b/pre"; falla before; }`,
        "cat <<'__SSHORUS_PATCH__' > \"$b/patch.py\"\n" + PY_LOG_PATCH + "\n__SSHORUS_PATCH__",
        `python3 "$b/patch.py" ${args} "$b/new" > "$b/out" || falla patch`,
        `edited=$(sed -n 's/^file=//p' "$b/out"); state=$(sed -n 's/^state=//p' "$b/out")`,
        'echo "@@estado $state"; echo "El sitio está en $edited"',
        ...(action === "disable" ? ['[ "$state" = absent ] && exit 0'] : []),
      ];
    case "backup":
      return [
        'if [ "$state" = changed ]; then',
        `  mkdir -p ${LOG_BACKUP_DIR} && chmod 700 ${LOG_BACKUP_DIR} || falla backup`,
        `  bk="${LOG_BACKUP_DIR}/$(basename "$edited").$(date +%Y%m%d-%H%M%S)-$$"`,
        '  cp -p "$edited" "$bk" && cp -p "$edited" "$b/orig" || falla backup',
        '  echo "Copia de $edited en $bk"',
        'else echo "La configuración no cambia: no hace falta copia."; fi',
      ];
    case "folder":
      return [`mkdir -p ${dir} || falla folder`, ...ownerSteps(site, logDir(log), log), ...selinuxSteps(site, logDir(log))];
    case "edit":
      return ['if [ "$state" = changed ]; then', '  installed=1; cat "$b/new" > "$edited" || falla edit', '  echo "Editado $edited"', "fi"];
    case "validate":
      return [`${validate} 2>&1 || { diag; falla validate; }`];
    case "reload":
      return [`${reload} 2>&1 || { diag; falla reload; }`, "reloaded=1"];
    case "verify":
      // La recarga de nginx (y la de Caddy por systemd) termina antes de que los procesos nuevos
      // atiendan: se repite la visita unos segundos hasta que aparece en el registro.
      return [
        `s0=$(wc -c < ${q} 2>/dev/null || echo 0)`,
        "i=0; s1=$s0",
        "while [ $i -lt 5 ]; do",
        probeCommand(site),
        `  sleep 1; s1=$(wc -c < ${q} 2>/dev/null || echo 0); [ "$s1" -gt "$s0" ] && break; i=$((i+1))`,
        "done",
        `if [ "$s1" -gt "$s0" ]; then echo '@@verifica ok'; tail -n 1 ${q} | cut -c1-300`,
        "else echo '@@verifica nada'; diag; fi",
      ];
  }
}

/**
 * Plan para poner (`enable`) o quitar (`disable`) el registro propio de `site`. Null si no hay forma
 * de encontrar su bloque (Caddy sin dominio o nginx sin archivo y línea).
 */
export function siteLogPlan(server: ServerInfo, site: Site, action: LogAction): SiteLogPlan | null {
  const t = patchTarget(server, site);
  if (!t) return null;
  const logPath = suggestedLogPath(site);
  const name = site.server === "caddy" ? "Caddy" : "nginx";
  const label = site.names[0] ?? "sitio por defecto";
  const keys = STEPS[action];
  const dir = shQuote(logDir(logPath));
  const args = [action, site.server, t.where, t.target, logPath, TRAFFIC_LOG_MARK].map(shQuote).join(" ");
  const ctx: StepCtx = { action, server, site, log: logPath, args };
  const script = [
    "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin",
    'paso() { echo "@@paso $1"; }',
    'falla() { echo "@@fallo $1"; exit 1; }',
    "selinux_on() { command -v selinuxenabled >/dev/null 2>&1 && selinuxenabled; }",
    `diag() { ls -ld ${dir} ${shQuote(logPath)} 2>&1; selinux_on && ls -Zd ${dir} ${shQuote(logPath)} 2>&1; selinux_on && command -v ausearch >/dev/null 2>&1 && ausearch -m avc -ts recent 2>/dev/null | grep -E 'comm="(caddy|nginx)"' | tail -n 3 | sed 's/^/@@selinux /'; return 0; }`,
    ...keys.flatMap((k) => [`paso ${k}`, ...stepScript(k, ctx)]),
  ].join("\n");
  return {
    action,
    title: `${action === "enable" ? "Activar" : "Quitar"} el registro de visitas de ${label} (${name})`,
    logPath,
    steps: keys.map((key) => ({ key, label: STEP_LABEL[key] })),
    script,
    brief: script.replace(PY_LOG_PATCH, "# (parche en Python: edita solo el bloque de este sitio)"),
  };
}
