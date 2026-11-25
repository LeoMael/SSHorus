// Analizador de registros de visitas en Python 3 (solo la biblioteca estándar), para webTraffic.ts.
// Lee como mucho `max_bytes` desde el final del registro y, si queda margen, de sus archivos rotados
// (`.1`, `.2.gz` de logrotate o `-AAAA-MM-DD….log.gz` de Caddy) más nuevos que el periodo; agrega todo
// en una sola pasada y escribe un único JSON en stdout. Compatible con Python 3.6.
export const PY_ANALYZER = String.raw`
import collections, datetime, glob, gzip, json, os, re, sys, time, urllib.parse

mode, path, range_key, hosts_csv, no_static, no_bots, max_b = sys.argv[1:8]
max_b = int(max_b)
no_static = no_static == "1"
no_bots = no_bots == "1"
hosts = {h.strip().lower() for h in hosts_csv.split(",") if h.strip()}
now = int(time.time())
span = {"24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400}.get(range_key, 86400)
since = now - span
hourly = range_key == "24h"
step = 3600 if hourly else 86400
n_buckets = 24 if hourly else (7 if range_key == "7d" else 30)
start_slot = (now // step - (n_buckets - 1)) * step

STATIC_RE = re.compile(r"(?:\.(?:css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|otf|mp4|webm|wasm)|^/(?:favicon\.ico|robots\.txt|sitemap\.xml))$", re.I)
BOT_RE = re.compile(r"bot|crawl|spider|slurp|mediapartners|bingpreview|facebookexternalhit|whatsapp|telegrambot|discordbot|curl/|wget/|python-requests|python-urllib|go-http-client|httpclient|libwww|scrapy|headless|lighthouse|uptime|pingdom|statuscake|datadog|prometheus|zgrab|masscan|censys|nuclei|nikto|sqlmap|sshorus", re.I)
NGX_RE = re.compile(r'^(?P<ip>\S+)\s+\S+\s+\S+\s+\[(?P<ts>[^\]]+)\]\s+"(?P<req>[^"]*)"\s+(?P<st>\d{3})\s+(?P<sz>\d+|-)(?:\s+"(?P<ref>[^"]*)"\s+"(?P<ua>[^"]*)")?')
MONTHS = {"Jan":1,"Feb":2,"Mar":3,"Apr":4,"May":5,"Jun":6,"Jul":7,"Aug":8,"Sep":9,"Oct":10,"Nov":11,"Dec":12}

def parse_ngx_ts(s):
    m = re.match(r"(\d{2})/([A-Za-z]{3})/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?", s)
    if not m:
        return None
    mon = MONTHS.get(m.group(2))
    if not mon:
        return None
    tz = datetime.timezone.utc
    if m.group(7):
        sign = 1 if m.group(7)[0] == "+" else -1
        off = sign * (int(m.group(7)[1:3]) * 60 + int(m.group(7)[3:5]))
        tz = datetime.timezone(datetime.timedelta(minutes=off))
    return int(datetime.datetime(int(m.group(3)), mon, int(m.group(1)), int(m.group(4)), int(m.group(5)), int(m.group(6)), tzinfo=tz).timestamp())

def norm_host(h):
    h = (h or "").strip().lower()
    if h.startswith("["):
        return h.split("]")[0][1:]
    return h.split(":")[0]

def clean_path(uri):
    p = (uri or "/").split("?", 1)[0] or "/"
    return p[:160]

def ref_host(r):
    if not r or r == "-":
        return None
    try:
        h = urllib.parse.urlsplit(r).hostname
        return h.lower() if h else None
    except Exception:
        return None

file_size = 0
scanned = 0
truncated = False
note = None
rotated_read = 0
GZ_WORK_MAX = 64 * 1024 * 1024

def rotated(p):
    d, base = os.path.split(p)
    stem = base[:-4] if base.endswith(".log") else base
    found = set(glob.glob(glob.escape(p) + ".*"))
    found.update(glob.glob(os.path.join(glob.escape(d), glob.escape(stem) + "-[0-9][0-9][0-9][0-9]-*.log*")))
    files = [f for f in found if os.path.isfile(f) and os.access(f, os.R_OK)]
    return sorted(files, key=os.path.getmtime, reverse=True)

def tail_plain(f, budget):
    size = os.path.getsize(f)
    with open(f, "rb") as h:
        if size > budget:
            h.seek(size - budget)
            h.readline()
        return h.read(budget), size > budget

def tail_gz(f, budget, work):
    ring = collections.deque()
    kept = 0
    cut = False
    with gzip.open(f, "rb") as g:
        while True:
            block = g.read(1 << 20)
            if not block:
                break
            work[0] += len(block)
            ring.append(block)
            kept += len(block)
            while ring and kept - len(ring[0]) >= budget:
                kept -= len(ring.popleft())
                cut = True
            if work[0] > GZ_WORK_MAX:
                cut = True
                break
    data = b"".join(ring)
    if len(data) > budget:
        data = data[len(data) - budget:]
        cut = True
    if cut:
        data = data.split(b"\n", 1)[-1]
    return data, cut

def iter_lines():
    global file_size, scanned, truncated, note, rotated_read
    if mode == "journal":
        for raw in sys.stdin.buffer:
            scanned += len(raw)
            if scanned > max_b:
                truncated = True
                break
            yield raw.decode("utf-8", "replace")
        return
    if not os.path.exists(path):
        note = "El archivo de registro aún no existe: todavía no ha recibido visitas."
        return
    if not os.access(path, os.R_OK):
        note = "Sin permiso para leer el archivo de registro (prueba con sudo)."
        return
    # Lo más nuevo primero (el archivo actual y luego los rotados), hasta gastar el tope de bytes.
    blobs = []
    work = [0]
    for f in [path] + rotated(path):
        budget = max_b - scanned
        if budget <= 0:
            truncated = True
            break
        if f != path and os.path.getmtime(f) < since:
            break
        try:
            data, cut = tail_gz(f, budget, work) if f.endswith(".gz") else tail_plain(f, budget)
        except (OSError, EOFError, ValueError):
            continue
        file_size += os.path.getsize(f)
        scanned += len(data)
        truncated = truncated or cut
        rotated_read += 1 if f != path else 0
        blobs.append(data)
    for data in reversed(blobs):
        for line in data.decode("utf-8", "replace").splitlines():
            yield line

lines_read = 0
total = 0
total_bytes = 0
static_skipped = 0
bot_skipped = 0
host_filtered = False
ips = set()
st_counts = {"s2xx": 0, "s3xx": 0, "s4xx": 0, "s5xx": 0}
b_req = [0] * n_buckets
b_err = [0] * n_buckets
path_map = {}
ip_map = {}
ref_map = collections.Counter()
recent = collections.deque(maxlen=20)

for line in iter_lines():
    line = line.strip()
    if not line:
        continue
    lines_read += 1
    ts = None; ip = ""; method = "GET"; uri = "/"; status = 0; size = 0; ref = ""; ua = ""; host = ""
    if line.startswith("{"):
        try:
            obj = json.loads(line)
        except Exception:
            continue
        req = obj.get("request")
        if not isinstance(req, dict):
            continue
        raw_ts = obj.get("ts")
        if isinstance(raw_ts, (int, float)):
            ts = int(raw_ts / 1000) if raw_ts > 1e12 else int(raw_ts)
        elif isinstance(raw_ts, str):
            try:
                ts = int(datetime.datetime.fromisoformat(raw_ts.replace("Z", "+00:00")).timestamp())
            except Exception:
                ts = None
        if ts is None:
            continue
        host = norm_host(req.get("host"))
        if hosts and host:
            host_filtered = True
            if host not in hosts:
                continue
        ip = norm_host(req.get("client_ip") or req.get("remote_ip") or "")
        method = str(req.get("method") or "GET")[:12]
        uri = str(req.get("uri") or "/")
        status = int(obj.get("status") or 0)
        size = int(obj.get("size") or 0)
        hdrs = req.get("headers") if isinstance(req.get("headers"), dict) else {}
        ua_l = hdrs.get("User-Agent") or hdrs.get("user-agent") or []
        ref_l = hdrs.get("Referer") or hdrs.get("referer") or []
        ua = str(ua_l[0]) if isinstance(ua_l, list) and ua_l else str(ua_l or "")
        ref = str(ref_l[0]) if isinstance(ref_l, list) and ref_l else str(ref_l or "")
    else:
        m = NGX_RE.match(line)
        if not m:
            continue
        ts = parse_ngx_ts(m.group("ts"))
        if ts is None:
            continue
        ip = m.group("ip")
        parts = m.group("req").split()
        method = parts[0][:12] if parts else "GET"
        uri = parts[1] if len(parts) > 1 else "/"
        status = int(m.group("st"))
        sz = m.group("sz")
        size = int(sz) if sz and sz.isdigit() else 0
        ref = m.group("ref") or ""
        ua = m.group("ua") or ""

    if ts < since or ts > now + 300:
        continue
    p = clean_path(uri)
    if no_static and STATIC_RE.search(p):
        static_skipped += 1
        continue
    if no_bots and ua and BOT_RE.search(ua):
        bot_skipped += 1
        continue

    total += 1
    total_bytes += size
    if ip:
        ips.add(ip)
    if 200 <= status < 300: st_counts["s2xx"] += 1
    elif 300 <= status < 400: st_counts["s3xx"] += 1
    elif 400 <= status < 500: st_counts["s4xx"] += 1
    elif 500 <= status < 600: st_counts["s5xx"] += 1
    is_err = 1 if status >= 400 else 0

    idx = (ts - start_slot) // step
    if 0 <= idx < n_buckets:
        b_req[idx] += 1
        b_err[idx] += is_err

    pe = path_map.get(p)
    if pe:
        pe[0] += 1; pe[1] += is_err; pe[2] += size
    elif len(path_map) < 5000:
        path_map[p] = [1, is_err, size]

    if ip:
        ie = ip_map.get(ip)
        if ie:
            ie[0] += 1; ie[1] += is_err
        elif len(ip_map) < 5000:
            ip_map[ip] = [1, is_err]

    rh = ref_host(ref)
    if rh and rh not in hosts:
        ref_map[rh] += 1

    recent.append({"ts": ts, "method": method, "path": p, "status": status, "ip": ip, "bytes": size, "ua": ua[:120]})

buckets = []
for i in range(n_buckets):
    bt = start_slot + i * step
    dt = datetime.datetime.fromtimestamp(bt)
    lbl = dt.strftime("%H:00") if hourly else dt.strftime("%d/%m")
    buckets.append({"label": lbl, "ts": bt, "requests": b_req[i], "errors": b_err[i]})

top_paths = [{"path": k, "count": v[0], "errors": v[1], "bytes": v[2]} for k, v in sorted(path_map.items(), key=lambda x: -x[1][0])[:12]]
top_ips = [{"ip": k, "count": v[0], "errors": v[1]} for k, v in sorted(ip_map.items(), key=lambda x: -x[1][0])[:10]]
top_refs = [{"host": k, "count": v} for k, v in ref_map.most_common(8)]

if note is None and total == 0:
    if lines_read == 0:
        note = "El registro está vacío: todavía no ha recibido visitas."
    elif static_skipped + bot_skipped == 0:
        note = "Todavía no hay visitas en este periodo."

out = {
    "range": range_key,
    "totalRequests": total,
    "uniqueIps": len(ips),
    "totalBytes": total_bytes,
    "staticSkipped": static_skipped,
    "botSkipped": bot_skipped,
    "status": st_counts,
    "buckets": buckets,
    "topPaths": top_paths,
    "topIps": top_ips,
    "topReferrers": top_refs,
    "recent": list(reversed(recent)),
    "meta": {
        "source": "journalctl -u caddy" if mode == "journal" else path,
        "fileSize": file_size,
        "scannedBytes": scanned,
        "truncated": truncated,
        "linesRead": lines_read,
        "rotatedFiles": rotated_read,
        "engine": "python3",
        "sharedLog": False,
        "hostFiltered": host_filtered,
        "note": note,
    },
}
print(json.dumps(out, separators=(",", ":")))
`.trim();
