// Planes seguros para activar un registro de visitas dedicado a un sitio (Caddy o nginx).
// Siempre muestran el comando exacto antes de ejecutarse, guardan copia de respaldo, validan la
// configuración y restauran el archivo original si algo falla. Funciones puras.
import type { Plan } from "./commands";
import { shQuote } from "./shell";
import { reloadSteps, type ServerInfo, type Site } from "./web";

export const TRAFFIC_LOG_MARK = "# sshorus-traffic-log";

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

/** Ruta por defecto donde SSHorus propone guardar el registro del sitio. */
export function suggestedLogPath(site: Pick<Site, "names" | "server" | "key">): string {
  const slug = siteLogSlug(site);
  return site.server === "caddy" ? `/var/log/caddy/${slug}.log` : `/var/log/nginx/${slug}.access.log`;
}

/**
 * Python compacto para insertar la directiva de log en el bloque del sitio (sin tocar el resto).
 * - Caddy: busca el archivo (el principal o sus `import`) con la cabecera del dominio e inserta un
 *   bloque `log { output file … { roll_size 10mb; roll_keep 5; roll_keep_for 720h }; format json }`.
 * - nginx: en `file` a partir de `line`, sustituye `access_log off;` si existe en ese `server {}` o
 *   inserta `access_log <logPath> combined;` tras la apertura `server {`.
 */
const PY_PATCH_CADDY = String.raw`
import glob, os, re, sys

cfg_path, host, log_path, mark, backup_out = sys.argv[1:6]

def collect_files(path, seen):
    real = os.path.realpath(path)
    if real in seen or not os.path.isfile(path):
        return []
    seen.add(real)
    files = [path]
    base = os.path.dirname(path)
    try:
        txt = open(path, "r", encoding="utf-8", errors="replace").read()
    except OSError:
        return files
    for m in re.finditer(r"^\s*import\s+([^\s#]+)", txt, re.M):
        pat = m.group(1).strip("\"'")
        full = pat if os.path.isabs(pat) else os.path.join(base, pat)
        for g in sorted(glob.glob(full)):
            files.extend(collect_files(g, seen))
    return files

def find_site_block(lines, target):
    low = target.lower()
    depth = 0
    for idx, line in enumerate(lines):
        stripped = line.split("#", 1)[0].strip()
        if depth == 0 and "{" in stripped:
            head = stripped.split("{", 1)[0].strip()
            addrs = [a.strip().rstrip(",") for a in re.split(r"[\s,]+", head) if a.strip()]
            for a in addrs:
                clean = re.sub(r"^https?://", "", a, flags=re.I).split(":")[0].lower()
                if clean == low:
                    # Buscar el cierre del bloque para comprobar si ya tiene «log»
                    d = stripped.count("{") - stripped.count("}")
                    end = idx
                    for j in range(idx + 1, len(lines)):
                        s2 = lines[j].split("#", 1)[0]
                        d += s2.count("{") - s2.count("}")
                        end = j
                        if d <= 0:
                            break
                    return idx, end
        depth += stripped.count("{") - stripped.count("}")
    return None

target_file = None
span = None
for f in collect_files(cfg_path, set()):
    try:
        ls = open(f, "r", encoding="utf-8").read().splitlines(True)
    except OSError:
        continue
    hit = find_site_block(ls, host)
    if hit:
        target_file = f
        span = (ls, hit[0], hit[1])
        break

if not target_file or not span:
    sys.stderr.write(f"No se encontró el bloque de «{host}» en {cfg_path} ni en sus archivos importados.\n")
    sys.exit(2)

ls, start, end = span
body = "".join(ls[start + 1 : end])
if re.search(r"^\s*log\b", body, re.M):
    sys.stderr.write(f"El bloque de «{host}» en {target_file} ya tiene una directiva log: edítala en el editor.\n")
    sys.exit(3)

indent = "\t"
for l in ls[start + 1 : end]:
    m = re.match(r"^([ \t]+)\S", l)
    if m:
        indent = m.group(1)
        break

snippet = [
    f"{indent}{mark}\n",
    f"{indent}log {{\n",
    f"{indent}{indent}output file {log_path} {{\n",
    f"{indent}{indent}{indent}roll_size 10mb\n",
    f"{indent}{indent}{indent}roll_keep 5\n",
    f"{indent}{indent}{indent}roll_keep_for 720h\n",
    f"{indent}{indent}}}\n",
    f"{indent}{indent}format json\n",
    f"{indent}}}\n",
]

with open(backup_out, "w", encoding="utf-8") as bf:
    bf.write(target_file + "\n")
    bf.writelines(ls)

new_lines = ls[: start + 1] + snippet + ls[start + 1 :]
tmp = target_file + ".sshorus.tmp"
with open(tmp, "w", encoding="utf-8") as tf:
    tf.writelines(new_lines)
os.replace(tmp, target_file)
print(target_file)
`.trim();

const PY_PATCH_NGINX = String.raw`
import os, re, sys

file_path, line_no, log_path, mark, backup_out = sys.argv[1:6]
line_no = max(1, int(line_no))

if not os.path.isfile(file_path):
    sys.stderr.write(f"No existe el archivo {file_path}\n")
    sys.exit(2)

ls = open(file_path, "r", encoding="utf-8").read().splitlines(True)
start = None
for i in range(max(0, line_no - 2), min(len(ls), line_no + 4)):
    if "{" in ls[i].split("#", 1)[0]:
        start = i
        break
if start is None:
    sys.stderr.write(f"No se encontró la apertura del bloque server cerca de la línea {line_no} en {file_path}.\n")
    sys.exit(2)

depth = 0
end = len(ls) - 1
for j in range(start, len(ls)):
    s = ls[j].split("#", 1)[0]
    depth += s.count("{") - s.count("}")
    end = j
    if depth <= 0:
        break

indent = "    "
for l in ls[start + 1 : end]:
    m = re.match(r"^([ \t]+)\S", l)
    if m:
        indent = m.group(1)
        break

with open(backup_out, "w", encoding="utf-8") as bf:
    bf.write(file_path + "\n")
    bf.writelines(ls)

# Si el bloque tenía «access_log off;», se reemplaza en el sitio; si no, se inserta al inicio del bloque.
replaced = False
new_lines = list(ls)
for j in range(start + 1, end):
    if re.match(r"^\s*access_log\s+off\s*;", new_lines[j]):
        new_lines[j] = f"{indent}access_log {log_path} combined; {mark}\n"
        replaced = True
        break
if not replaced:
    new_lines.insert(start + 1, f"{indent}access_log {log_path} combined; {mark}\n")

tmp = file_path + ".sshorus.tmp"
with open(tmp, "w", encoding="utf-8") as tf:
    tf.writelines(new_lines)
os.replace(tmp, file_path)
print(file_path)
`.trim();

/**
 * Plan para activar un log de visitas dedicado a `site` (Caddy o nginx).
 * Devuelve null si el sitio no tiene suficiente información (p. ej. sin dominio en Caddy o sin archivo en nginx).
 */
export function enableSiteLogPlan(server: ServerInfo, site: Site): { plan: Plan; logPath: string } | null {
  const logPath = suggestedLogPath(site);
  const reload = reloadSteps(server);
  if (site.server === "caddy") {
    const host = site.names[0];
    if (!host) return null;
    const steps = [
      "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin",
      "command -v python3 >/dev/null 2>&1 || { echo 'Hace falta python3 para modificar el Caddyfile de forma segura' >&2; exit 1; }",
      "mkdir -p /var/log/caddy",
      "if id caddy >/dev/null 2>&1; then chown caddy:caddy /var/log/caddy && chmod 750 /var/log/caddy; fi",
      "b=$(mktemp -d)",
      `trap 'rm -f "$b/patch.py" "$b/bak"; rmdir "$b" 2>/dev/null || true' EXIT`,
      "cat <<'__SSHORUS_PATCH__' > \"$b/patch.py\"\n" + PY_PATCH_CADDY + "\n__SSHORUS_PATCH__",
      `edited=$(python3 "$b/patch.py" ${shQuote(server.configPath)} ${shQuote(host)} ${shQuote(logPath)} ${shQuote(TRAFFIC_LOG_MARK)} "$b/bak")`,
      `if ! (${reload.join(" && ")}); then`,
      `  tail -n +2 "$b/bak" > "$edited.sshorus.restore" && mv -f "$edited.sshorus.restore" "$edited"`,
      "  echo 'La configuración no pasó la validación de Caddy: se restauró el archivo original.' >&2",
      "  exit 1",
      "fi",
      `echo "Registro activado en ${logPath} (editado $edited)"`,
    ];
    return {
      logPath,
      plan: {
        action: `Activar registro de visitas para ${host} (Caddy)`,
        steps,
      },
    };
  }

  if (!site.file || !site.line) return null;
  const label = site.names[0] ?? "sitio";
  const steps = [
    "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin",
    "command -v python3 >/dev/null 2>&1 || { echo 'Hace falta python3 para modificar la configuración de nginx de forma segura' >&2; exit 1; }",
    "mkdir -p /var/log/nginx",
    "b=$(mktemp -d)",
    `trap 'rm -f "$b/patch.py" "$b/bak"; rmdir "$b" 2>/dev/null || true' EXIT`,
    "cat <<'__SSHORUS_PATCH__' > \"$b/patch.py\"\n" + PY_PATCH_NGINX + "\n__SSHORUS_PATCH__",
    `edited=$(python3 "$b/patch.py" ${shQuote(site.file)} ${site.line} ${shQuote(logPath)} ${shQuote(TRAFFIC_LOG_MARK)} "$b/bak")`,
    `if ! (${reload.join(" && ")}); then`,
    `  tail -n +2 "$b/bak" > "$edited.sshorus.restore" && mv -f "$edited.sshorus.restore" "$edited"`,
    "  echo 'La configuración no pasó nginx -t: se restauró el archivo original.' >&2",
    "  exit 1",
    "fi",
    `echo "Registro activado en ${logPath} (editado $edited)"`,
  ];
  return {
    logPath,
    plan: {
      action: `Activar registro de visitas para ${label} (nginx)`,
      steps,
    },
  };
}
