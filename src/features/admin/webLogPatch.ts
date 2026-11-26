// Python que edita la configuración de Caddy o nginx para poner o quitar el registro de visitas de un
// sitio, tocando solo el bloque de ese sitio. No escribe en el archivo: deja el resultado en otro
// archivo y dice cuál editar (`file=…`) y qué pasó (`state=changed|already|absent`), para que el
// script de la tarea haga la copia, lo instale en el sitio (conservando dueño, permisos y contexto
// SELinux), valide y recargue. Compatible con Python 3.6 (Rocky/Alma 8).
//
// Uso: patch.py enable|disable caddy|nginx <config o archivo> <dominio[|puerto] o línea> <log> <marca> <salida>
//
// - Caddy: busca el bloque cuya dirección es el dominio (en el Caddyfile o en lo que importa; con varios,
//   el de ese puerto: no el «http://dominio { redir … }» del mismo sitio) y añade
//   `log { output file … { roll_size … } format json }`. Un `log` propio del sitio que no escribe en
//   archivo (va al diario) se sustituye; uno que ya escribe en archivo se deja y se añade el nuestro.
// - nginx: en el `server {}` que empieza en esa línea, quita `access_log off;` de ese nivel (no el de
//   un `location`) y añade `access_log … combined;` en su lugar o, si no había, al final del bloque.
// - Lo sustituido queda como comentario «<marca> antes: …» y `disable` lo devuelve tal cual (también los
//   finales de línea CRLF). Las llaves entre comillas no cuentan como bloques.
export const PY_LOG_PATCH = String.raw`
import glob, os, re, sys

action, kind, where, target, log_path, mark, out_path = sys.argv[1:8]
PREV = mark + " antes: "

def fail(msg):
    sys.stderr.write(msg + "\n")
    sys.exit(2)

# Comillas de cada uno: en un Caddyfile «'» es un carácter más (it's) y sí valen las de acento grave.
QUOTES = "\"'" if kind == "nginx" else "\"" + chr(96)

def code(line, blank=False):
    q = None
    out = []
    for i, c in enumerate(line):
        if q:
            if c == q and line[i - 1] != "\\":
                q = None
            elif blank:
                c = " "
        elif c in QUOTES:
            q = c
        elif c == "#" and (i == 0 or line[i - 1] in " \t"):
            break
        out.append(c)
    return "".join(out)

def bare(line):
    return code(line, True)

def delta(line):
    c = bare(line)
    return c.count("{") - c.count("}")

def block_end(ls, start):
    d = 0
    for j in range(start, len(ls)):
        d += delta(ls[j])
        if d <= 0:
            return j
    fail("El bloque que empieza en la línea %d no se cierra." % (start + 1))

def top_level(ls, start, end):
    d = 0
    for j in range(start + 1, end):
        if d == 0:
            yield j
        d += delta(ls[j])

def read(path):
    with open(path, "r", encoding="utf-8", newline="") as f:
        return f.read().splitlines(True)

def indent_of(ls, start, end, fallback):
    for j in range(start + 1, end):
        m = re.match(r"^([ \t]+)\S", ls[j])
        if m:
            return m.group(1)
    return fallback

def caddy_files(path, seen):
    real = os.path.realpath(path)
    if real in seen or not os.path.isfile(path):
        return []
    seen.add(real)
    files = [path]
    try:
        lines = read(path)
    except (OSError, UnicodeDecodeError):
        return files
    for l in lines:
        m = re.match(r"^\s*import\s+(\S+)", code(l))
        if not m:
            continue
        pat = m.group(1).strip("\"'")
        full = pat if os.path.isabs(pat) else os.path.join(os.path.dirname(path), pat)
        for g in sorted(glob.glob(full)):
            files.extend(caddy_files(g, seen))
    return files

def caddy_addr(addr):
    a = addr.strip().rstrip(",")
    m = re.match(r"^([a-z]+)://", a, flags=re.I)
    scheme = m.group(1).lower() if m else ""
    a = (a[m.end():] if m else a).split("/")[0]
    port = 80 if scheme == "http" else 443
    m = re.match(r"^(.*):(\d+)$", a)
    if m:
        a, port = m.group(1), int(m.group(2))
    return a.strip("[]").lower(), port

def caddy_sites(ls, host):
    d = 0
    for i, l in enumerate(ls):
        c = code(l).strip()
        if d == 0 and bare(l).strip().endswith("{") and not c.startswith("("):
            addrs = [caddy_addr(a) for a in re.split(r"[\s,]+", c[:-1]) if a]
            ports = [p for h, p in addrs if h == host]
            if ports:
                yield i, ports
        d += delta(l)

def find_caddy():
    if where.endswith(".json"):
        fail("Caddy usa una configuración JSON (%s): añade el registro a mano en «logging» y en el servidor." % where)
    host, _, port = target.lower().partition("|")
    hits = []
    for f in caddy_files(where, set()):
        try:
            ls = read(f)
        except (OSError, UnicodeDecodeError):
            continue
        hits.extend((f, ls, i, ports) for i, ports in caddy_sites(ls, host))
    best = [h for h in hits if port.isdigit() and int(port) in h[3]] or hits
    if best:
        f, ls, i, _ = best[0]
        return f, ls, i, block_end(ls, i)
    fail("No se encontró el bloque de «%s» en %s ni en lo que importa (¿el dominio viene de una variable o de la API de Caddy?)." % (host, where))

def find_nginx():
    if not os.path.isfile(where):
        fail("No existe el archivo %s." % where)
    ls = read(where)
    i = int(target) - 1
    if i < 0 or i >= len(ls) or not re.match(r"^\s*server\b", code(ls[i])):
        fail("La línea %s de %s ya no es un «server {»: vuelve a cargar Sitios web y prueba otra vez." % (target, where))
    for j in range(i, min(len(ls), i + 4)):
        if "{" in bare(ls[j]):
            return where, ls, j, block_end(ls, j)
    fail("No se encontró la llave «{» del server de la línea %s en %s." % (target, where))

def caddy_log_block(ind):
    s = ind + ind
    return [ind + "log {\n", s + "output file " + log_path + " {\n", s + ind + "roll_size 10mb\n", s + ind + "roll_keep 5\n",
            s + ind + "roll_keep_for 720h\n", s + "}\n", s + "format json\n", ind + "}\n"]

def enable(ls, start, end):
    if end == start:
        fail("El bloque del sitio está en una sola línea (línea %d): sepáralo en varias líneas o edítalo a mano." % (start + 1))
    tops = list(top_level(ls, start, end))
    if any(mark in ls[j] and PREV not in ls[j] for j in tops):
        return "already", ls
    ind = indent_of(ls, start, end, "\t" if kind == "caddy" else "    ")
    drop = []
    if kind == "caddy":
        for j in tops:
            if re.match(r"^\s*log\s*(\{\s*)?$", code(ls[j])):
                e = block_end(ls, j) if "{" in bare(ls[j]) else j
                # Solo el que va al diario (stdout/stderr): uno a archivo o por red (net) se queda.
                if not any(re.match(r"^\s*output\s+(file|net)\b", code(x)) for x in ls[j:e + 1]):
                    drop.extend(range(j, e + 1))
        new = caddy_log_block(ind)
        at = start + 1
    else:
        drop = [j for j in tops if re.match(r"^\s*access_log\s+off\s*;\s*$", code(ls[j]))]
        new = [ind + "access_log " + log_path + " combined;\n"]
        at = end if ls[end].strip() == "}" else start + 1
    # Donde estaba lo sustituido, para que al quitarlo vuelva a su sitio.
    if drop:
        at = drop[0]
    head = [ind + mark + "\n"] + [ind + PREV + ls[j].rstrip("\n") + "\n" for j in drop]
    keep = [l for j, l in enumerate(ls) if j not in drop]
    at -= len([j for j in drop if j < at])
    return "changed", keep[:at] + head + new + keep[at:]

def disable(ls, start, end):
    out = ls[:start + 1]
    j = start + 1
    found = False
    while j < end:
        l = ls[j]
        if l.strip() == mark:
            found = True
            j += 1
            while j < end and ls[j].strip().startswith(PREV):
                raw = ls[j].split(PREV, 1)[1]
                out.append(raw if raw.endswith("\n") else raw + "\n")
                j += 1
            if j < end and kind == "caddy" and re.match(r"^\s*log\s*\{", code(ls[j])):
                j = block_end(ls, j) + 1
            elif j < end and kind == "nginx" and re.match(r"^\s*access_log\s", code(ls[j])):
                j += 1
            continue
        if kind == "nginx" and mark in l and re.match(r"^\s*access_log\s", code(l)):
            found = True
            j += 1
            continue
        out.append(l)
        j += 1
    return ("changed" if found else "absent"), out + ls[end:]

f, ls, start, end = find_caddy() if kind == "caddy" else find_nginx()
state, new = enable(ls, start, end) if action == "enable" else disable(ls, start, end)
if state == "changed":
    with open(out_path, "w", encoding="utf-8", newline="") as o:
        o.writelines(new)
print("file=" + f)
print("state=" + state)
`.trim();
