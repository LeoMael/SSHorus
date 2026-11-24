// Sitios web del servidor: scripts de lectura, coordinación nginx/Caddy y recarga.
// Los parsers viven en webNginx.ts, webCaddy.ts y webTypes.ts; todo se reexporta aquí.
import { shQuote, splitSections } from "../../lib/remote";
import { sitesFromCaddy } from "./webCaddy";
import { resolveNginx, sitesFromNginx, splitNginxDump } from "./webNginx";
import { parseCerts, type ServerInfo, type Site, type WebResult } from "./webTypes";

export * from "./webTypes";
export * from "./webNginx";
export * from "./webCaddy";

/** Deja en `cp` el nginx.conf que usa nginx (el de `nginx -V` o el habitual). */
export const NGINX_CONF_STEPS = [
  "cp=$(nginx -V 2>&1 | grep -oE -- '--conf-path=[^ ]+' | head -n1 | cut -d= -f2)",
  '[ -n "$cp" ] || cp=/etc/nginx/nginx.conf',
];

/** Deja en `cf` el Caddyfile que usa el servicio (su `--config` o el habitual). */
export const CADDY_CONF_STEPS = [
  "cf=$(systemctl cat caddy 2>/dev/null | grep -oE -- '--config[= ][^ ]+' | head -n1 | sed 's/^--config[= ]//')",
  '[ -n "$cf" ] || cf=/etc/caddy/Caddyfile',
];

const indent = (lines: string[]) => lines.map((l) => `  ${l}`);

/**
 * Script de lectura. nginx: `nginx -T` (configuración completa, necesita root casi siempre); si falla,
 * se leen los archivos de la carpeta de configuración con el mismo formato. Caddy: configuración en
 * vivo por su API local o, si no responde, `caddy adapt` del Caddyfile.
 */
export const WEB_SCRIPT = [
  "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin",
  "echo @@svc",
  "if command -v systemctl >/dev/null 2>&1; then for s in nginx caddy; do systemctl cat $s >/dev/null 2>&1 && echo \"$s $(systemctl is-active $s 2>/dev/null)\"; done; fi",
  "if command -v nginx >/dev/null 2>&1; then",
  ...indent(NGINX_CONF_STEPS),
  "  if out=$(nginx -T 2>/dev/null) && printf '%s\\n' \"$out\" | grep -q '^# configuration file '; then src=dump",
  "  else",
  "    src=files; d=$(dirname \"$cp\")",
  "    out=$(for f in \"$cp\" $(find -L \"$d\" -type f \\( -name '*.conf' -o -path '*/sites-enabled/*' \\) ! -path \"$cp\" 2>/dev/null | sort); do",
  "      [ -r \"$f\" ] && { echo \"# configuration file $f:\"; cat \"$f\"; echo; }",
  "    done)",
  "  fi",
  "  echo @@nginx; echo \"nginx $src $cp\"",
  "  echo @@nginxconf; printf '%s\\n' \"$out\"",
  "  echo @@certs",
  "  if command -v openssl >/dev/null 2>&1; then",
  "    for c in $(printf '%s\\n' \"$out\" | sed -n 's/^[[:space:]]*ssl_certificate[[:space:]][[:space:]]*\\([^;]*\\);.*/\\1/p' | tr -d \"\\\"'\" | grep -v '\\$' | sort -u); do",
  "      e=$(openssl x509 -noout -enddate -in \"$c\" 2>/dev/null | cut -d= -f2)",
  "      echo \"$c|$e\"",
  "    done",
  "  fi",
  "fi",
  "if command -v caddy >/dev/null 2>&1; then",
  ...indent(CADDY_CONF_STEPS),
  "  j=''; src=api",
  "  if command -v curl >/dev/null 2>&1; then j=$(curl -sf --max-time 3 http://127.0.0.1:2019/config/ 2>/dev/null)",
  "  elif command -v wget >/dev/null 2>&1; then j=$(wget -qO- -T 3 http://127.0.0.1:2019/config/ 2>/dev/null); fi",
  "  if [ -z \"$j\" ] || [ \"$j\" = null ]; then src=adapt; j=$(caddy adapt --config \"$cf\" 2>/dev/null); fi",
  "  echo @@caddy; echo \"caddy $src $cf\"",
  "  echo @@caddyjson; printf '%s\\n' \"$j\"",
  "fi",
  "echo @@end",
].join("\n");

export function parseWeb(stdout: string): WebResult {
  // Se conservan las líneas vacías (para numerar las líneas de los archivos).
  const s = splitSections(stdout, { blank: "keep" });
  const svc = new Map<string, string>();
  for (const l of s.get("svc") ?? []) {
    const [n, st] = l.trim().split(/\s+/);
    if (n && st) svc.set(n, st);
  }
  const servers: ServerInfo[] = [];

  const ng = (s.get("nginx") ?? []).find((l) => l.trim())?.trim().split(/\s+/);
  if (ng) {
    const source = ng[1] === "dump" ? "dump" : "files";
    const configPath = ng.slice(2).join(" ") || "/etc/nginx/nginx.conf";
    const files = splitNginxDump(s.get("nginxconf") ?? []);
    let sites: Site[] = [];
    let warning: string | null = null;
    if (files.size === 0) warning = "No se pudo leer la configuración de nginx (¿falta permiso? Prueba con sudo).";
    else {
      try {
        sites = sitesFromNginx(resolveNginx(files, configPath), parseCerts((s.get("certs") ?? []).filter((l) => l.trim())));
      } catch (e) {
        warning = `No se pudo interpretar la configuración: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (!warning && source === "files")
        warning = "Configuración leída de los archivos (sin root no se puede usar «nginx -T»): puede faltar algún archivo sin permiso de lectura.";
    }
    servers.push({ server: "nginx", source, configPath, status: svc.get("nginx") ?? null, sites, warning });
  }

  const cd = (s.get("caddy") ?? []).find((l) => l.trim())?.trim().split(/\s+/);
  if (cd) {
    const source = cd[1] === "api" ? "api" : "adapt";
    const configPath = cd.slice(2).join(" ") || "/etc/caddy/Caddyfile";
    const text = (s.get("caddyjson") ?? []).join("\n").trim();
    let sites: Site[] = [];
    let warning: string | null = null;
    if (!text || text === "null") warning = "No se pudo leer la configuración de Caddy (ni por su API local ni con «caddy adapt»).";
    else {
      try {
        sites = sitesFromCaddy(JSON.parse(text), configPath);
      } catch {
        warning = "La configuración de Caddy no es un JSON válido.";
      }
    }
    servers.push({ server: "caddy", source, configPath, status: svc.get("caddy") ?? null, sites, warning });
  }
  return { servers };
}

/** Comprueba la configuración sin aplicar nada. */
export function checkScript(info: Pick<ServerInfo, "server" | "configPath">): string {
  const path = "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin";
  if (info.server === "nginx") return `${path}\nnginx -t -c ${shQuote(info.configPath)} 2>&1`;
  return `${path}\ncaddy validate --config ${shQuote(info.configPath)} 2>&1`;
}

/** Pasos para recargar sin cortar las conexiones (primero se comprueba la configuración). */
export function reloadSteps(info: Pick<ServerInfo, "server" | "configPath" | "status">): string[] {
  const q = shQuote(info.configPath);
  const systemd = info.status === "active";
  if (info.server === "nginx") {
    return [`nginx -t -c ${q}`, systemd ? "systemctl reload nginx" : `nginx -s reload -c ${q}`];
  }
  return [`caddy validate --config ${q}`, systemd ? "systemctl reload caddy" : `caddy reload --config ${q}`];
}
