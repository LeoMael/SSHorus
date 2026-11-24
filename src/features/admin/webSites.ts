// Sitios web «dominio → puerto local» para la Biblioteca (y el asistente por MCP con «Solo lo marcado»).
// Funciones puras, sin React ni Tauri.
//
// Cada sitio va en su propio archivo marcado «# Creado por SSHorus» (Caddy: <carpeta del Caddyfile>/sites/
// <dominio>.caddy, importada desde el Caddyfile; nginx: conf.d/ o http.d/<dominio>.conf). Tras el cambio se
// comprueba la configuración y se recarga con los mismos pasos que Administración (`web.ts`); si algo falla,
// se deja todo como estaba. Editar y borrar solo tocan archivos con la marca.
import { failIf, ifElse, runtime, sudoCatalogCommand } from "./catalogScript";
import type { GeneratedRow } from "./catalogUsers";
import { shQuote } from "../../lib/remote";
import { CADDY_CONF_STEPS, checkScript, NGINX_CONF_STEPS, reloadSteps, type WebServer } from "./web";

export const SITE_MARK = "# Creado por SSHorus";

type Mode = "create" | "edit" | "delete";

const PATH = "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin";

const DOMAIN_CHECK = failIf(
  `case "$1" in ""|.*|-*|*..*|*[!A-Za-z0-9.*-]*) true;; *) false;; esac`,
  "Dominio no válido (p. ej. app.ejemplo.com)",
);
const PORT_CHECKS = [
  failIf(`case "$2" in ""|*[!0-9]*) true;; *) false;; esac`, "Puerto no válido"),
  failIf(`[ "$2" -lt 1 ] || [ "$2" -gt 65535 ]`, "Puerto no válido (1-65535)"),
];

/** Dónde está cada servidor web y su archivo de sitio (`f`), y si el servicio está en marcha (`st`). */
const LOCATE: Record<WebServer, string[]> = {
  caddy: [
    "command -v caddy >/dev/null 2>&1 || { echo 'Caddy no está instalado' >&2; exit 1; }",
    ...CADDY_CONF_STEPS,
    `[ -f "$cf" ] || { echo "No existe $cf" >&2; exit 1; }`,
    'dir=$(dirname "$cf")/sites',
    'f="$dir/$1.caddy"',
    "st=$(systemctl is-active caddy 2>/dev/null || true)",
  ],
  nginx: [
    "command -v nginx >/dev/null 2>&1 || { echo 'nginx no está instalado' >&2; exit 1; }",
    ...NGINX_CONF_STEPS,
    'base=$(dirname "$cp")',
    'if [ -d "$base/http.d" ]; then dir="$base/http.d"; else dir="$base/conf.d"; fi',
    `if ! grep -Eq "include[[:space:]]+[^;]*$(basename "$dir")/\\*\\.conf" "$cp"; then echo "$cp no incluye $dir/*.conf: añádelo a mano" >&2; exit 1; fi`,
    'f="$dir/$1.conf"',
    "st=$(systemctl is-active nginx 2>/dev/null || true)",
  ],
};

const CONF_VAR: Record<WebServer, string> = { caddy: "cf", nginx: "cp" };

/** Líneas del archivo del sitio: las que llevan $1/$2 van entre comillas dobles; el resto, literales. */
function siteFile(server: WebServer): string[] {
  const lines: [string, boolean][] =
    server === "caddy"
      ? [
          [SITE_MARK, false],
          ["$1 {", true],
          ["\treverse_proxy 127.0.0.1:$2", true],
          ["}", false],
        ]
      : [
          [SITE_MARK, false],
          ["server {", false],
          ["    listen 80;", false],
          ["    listen [::]:80;", false],
          ["    server_name $1;", true],
          ["    location / {", false],
          ["        proxy_pass http://127.0.0.1:$2;", true],
          ["        proxy_http_version 1.1;", false],
          ["        proxy_set_header Host $host;", false],
          ["        proxy_set_header X-Real-IP $remote_addr;", false],
          ["        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;", false],
          ["        proxy_set_header X-Forwarded-Proto $scheme;", false],
          ["    }", false],
          ["}", false],
        ];
  const args = lines.map(([text, dynamic]) => (dynamic ? `"${text}"` : shQuote(text)));
  return [`printf '%s\\n' ${args.join(" ")} > "$f.tmp"`, 'mv -f "$f.tmp" "$f"'];
}

/** Comprobar y recargar (pasos de `web.ts`), según el servicio esté en marcha por systemd o no. */
function applyCondition(server: WebServer): string {
  const configPath = runtime(CONF_VAR[server]);
  const running = reloadSteps({ server, configPath, status: "active" }).join(" && ");
  const manual = reloadSteps({ server, configPath, status: null }).join(" && ");
  return `{ if [ "$st" = active ]; then ${running}; else ${manual}; fi; }`;
}

function siteSteps(server: WebServer, mode: Mode): string[] {
  const exists =
    mode === "create"
      ? [failIf('[ -e "$f" ]', "Ese sitio ya existe: usa «Editar sitio»")]
      : [failIf(`[ ! -f "$f" ] || ! head -n1 "$f" | grep -qxF ${shQuote(SITE_MARK)}`, "Ese sitio no existe o no lo creó SSHorus: no se toca")];
  const importLine =
    server === "caddy" && mode !== "delete"
      ? ['imp="import $dir/*.caddy"', 'grep -qxF "$imp" "$cf" || printf \'\\n%s\\n\' "$imp" >> "$cf"']
      : [];
  const change = mode === "delete" ? ['rm -f "$f"'] : siteFile(server);
  const done =
    mode === "delete"
      ? 'echo "Sitio $1 borrado y configuración recargada"'
      : `echo "Sitio $1 → 127.0.0.1:$2 guardado en $f y configuración recargada"`;
  return [
    PATH,
    DOMAIN_CHECK,
    ...(mode === "delete" ? [] : PORT_CHECKS),
    ...LOCATE[server],
    ...exists,
    "b=$(mktemp -d)",
    // Sin «rm -r»: así el diálogo de permiso no lo marca como borrado recursivo.
    `trap 'rm -f "$b/main" "$b/site"; rmdir "$b"' EXIT`,
    server === "caddy" ? 'cp -p "$cf" "$b/main"' : ":",
    'if [ -f "$f" ]; then cp -p "$f" "$b/site"; fi',
    `restore() { ${server === "caddy" ? 'cat "$b/main" > "$cf"; ' : ""}if [ -f "$b/site" ]; then cp -p "$b/site" "$f"; else rm -f "$f"; fi; }`,
    'mkdir -p "$dir"',
    ...importLine,
    ...change,
    ...ifElse(`! ${applyCondition(server)}`, ["restore", "echo 'La configuración no pasó la comprobación o no se pudo recargar: se dejó como estaba' >&2", "exit 1"], [done]),
  ];
}

const LABEL: Record<WebServer, string> = { caddy: "Caddy", nginx: "nginx" };

function siteRows(server: WebServer): GeneratedRow[] {
  const L = LABEL[server];
  const row = (mode: Mode, name: string, description: string, flags: string): GeneratedRow => {
    const id = `${server}-${mode === "create" ? "crear" : mode === "edit" ? "editar" : "borrar"}-sitio`;
    const vars = mode === "delete" ? ["dominio"] : ["dominio", "puerto"];
    return { id, name, description, command: sudoCatalogCommand(id, siteSteps(server, mode), vars), flags };
  };
  return [
    row("create", `Crear sitio (${L})`, `Publica un dominio que apunta a un puerto local, en su propio archivo. Comprueba la configuración y recarga ${L}; si falla, lo deja como estaba.`, "s"),
    row("edit", `Cambiar el puerto de un sitio (${L})`, `Cambia el puerto de un sitio creado por SSHorus. Si la comprobación falla, lo deja como estaba.`, "s"),
    row("delete", `Borrar sitio (${L})`, `Borra un sitio creado por SSHorus y recarga ${L}. Si la comprobación falla, lo deja como estaba.`, "sd"),
  ];
}

export const WEB_SITE_ROWS: GeneratedRow[] = [
  ...siteRows("caddy"),
  {
    id: "caddy-probar",
    name: "Probar configuración Caddy",
    description: "Comprueba el Caddyfile sin aplicar nada.",
    command: sudoCatalogCommand("caddy-probar", [...LOCATE.caddy.slice(0, 3), ...checkScript({ server: "caddy", configPath: runtime("cf") }).split("\n")], []),
    flags: "rs",
  },
  {
    id: "caddy-recargar",
    name: "Recargar Caddy",
    description: "Comprueba y aplica la configuración sin cortar las conexiones.",
    command: sudoCatalogCommand("caddy-recargar", [PATH, ...LOCATE.caddy.slice(0, 3), "st=$(systemctl is-active caddy 2>/dev/null || true)", applyCondition("caddy")], []),
    flags: "s",
  },
  ...siteRows("nginx"),
  {
    id: "sitios-sshorus",
    name: "Sitios creados por SSHorus",
    description: "Muestra los archivos de sitio que creó SSHorus (Caddy y nginx).",
    command: `for f in /etc/caddy/sites/*.caddy /etc/nginx/conf.d/*.conf /etc/nginx/http.d/*.conf; do [ -f "$f" ] && head -n1 "$f" | grep -qxF '${SITE_MARK}' && { echo "== $f"; cat "$f"; echo; }; done; true`,
    flags: "r",
  },
];
