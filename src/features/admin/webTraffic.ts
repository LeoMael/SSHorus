// Análisis de tráfico / visitas de un sitio (Caddy JSON, nginx combined o journald de Caddy).
// Diseñado para servidores pequeños (1 vCPU): 100 % bajo demanda, prioridad mínima (`nice -n 19` +
// `ionice -c3`), tope de 8 MiB leídos desde el final (seek O(1), nunca recorre gigabytes) y límite
// de 15 s. Devuelve un JSON compacto (~4 KB). Funciones puras.
import { shQuote } from "../../lib/remote";
import type { Site } from "./web";

export type TrafficRange = "24h" | "7d" | "30d";

export interface TrafficQuery {
  range: TrafficRange;
  excludeStatic: boolean;
  excludeBots: boolean;
  /** Si el log está en journald (Caddy sin archivo) y el usuario pide leerlo. */
  useJournal?: boolean;
}

export interface TrafficBucket {
  label: string;
  ts: number;
  requests: number;
  errors: number;
}

export interface TrafficPathRow {
  path: string;
  count: number;
  errors: number;
  bytes: number;
}

export interface TrafficIpRow {
  ip: string;
  count: number;
  errors: number;
}

export interface TrafficRefRow {
  host: string;
  count: number;
}

export interface TrafficRecentRow {
  ts: number;
  method: string;
  path: string;
  status: number;
  ip: string;
  bytes: number;
  ua: string;
}

export interface TrafficReport {
  range: TrafficRange;
  totalRequests: number;
  uniqueIps: number;
  totalBytes: number;
  staticSkipped: number;
  botSkipped: number;
  status: { s2xx: number; s3xx: number; s4xx: number; s5xx: number };
  buckets: TrafficBucket[];
  topPaths: TrafficPathRow[];
  topIps: TrafficIpRow[];
  topReferrers: TrafficRefRow[];
  recent: TrafficRecentRow[];
  meta: {
    source: string;
    fileSize: number;
    scannedBytes: number;
    truncated: boolean;
    linesRead: number;
    engine: "python3" | "awk";
    sharedLog: boolean;
    hostFiltered: boolean;
    note: string | null;
  };
}

/** Tope de bytes que se leen desde el final del log (8 MiB): rápido y seguro en 1 vCPU. */
export const MAX_LOG_BYTES = 8 * 1024 * 1024;

export const RANGE_SECS: Record<TrafficRange, number> = {
  "24h": 24 * 3600,
  "7d": 7 * 86400,
  "30d": 30 * 86400,
};

/**
 * Analizador compacto en Python 3 (stdlib pura: json, re, os, sys, time, datetime, collections, urllib).
 * Lee como mucho `max_bytes` desde el final de un archivo (o de stdin para journald), agrega todo en
 * una sola pasada y escribe un único JSON en stdout.
 */
const PY_ANALYZER = String.raw`
import collections, datetime, json, os, re, sys, time, urllib.parse

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
BOT_RE = re.compile(r"bot|crawl|spider|slurp|mediapartners|bingpreview|facebookexternalhit|whatsapp|telegrambot|discordbot|curl/|wget/|python-requests|python-urllib|go-http-client|httpclient|libwww|scrapy|headless|lighthouse|uptime|pingdom|statuscake|datadog|prometheus|zgrab|masscan|censys|nuclei|nikto|sqlmap", re.I)
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

def iter_lines():
    global file_size, scanned, truncated, note
    if mode == "journal":
        for raw in sys.stdin.buffer:
            scanned += len(raw)
            if scanned > max_b:
                truncated = True
                break
            yield raw.decode("utf-8", "replace")
        return
    if not os.path.exists(path):
        note = "El archivo de registro aún no existe (quizá todavía no ha recibido visitas)."
        return
    if not os.access(path, os.R_OK):
        note = "Sin permiso para leer el archivo de registro (prueba con sudo)."
        return
    file_size = os.path.getsize(path)
    with open(path, "rb") as f:
        if file_size > max_b:
            f.seek(file_size - max_b)
            f.readline()  # descarta la primera línea cortada
            truncated = True
        data = f.read(max_b)
        scanned = len(data)
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
        "engine": "python3",
        "sharedLog": False,
        "hostFiltered": host_filtered,
        "note": note,
    },
}
print(json.dumps(out, separators=(",", ":")))
`.trim();

/** Construye el script POSIX que ejecuta el análisis con prioridad mínima (`nice`/`ionice`) y tope de tiempo. */
export function trafficScript(site: Site, q: TrafficQuery): string {
  const log = site.accessLog;
  const journal = !!q.useJournal || (log?.format === "journal" && !log.path);
  const path = log?.path ?? "";
  const mode = journal ? "journal" : "file";
  const hosts = site.names.filter((h) => h && !h.includes("*")).join(",");
  const pyArgs = `${shQuote(mode)} ${shQuote(path)} ${shQuote(q.range)} ${shQuote(hosts)} ${q.excludeStatic ? "1" : "0"} ${q.excludeBots ? "1" : "0"} ${MAX_LOG_BYTES}`;
  const sinceArg = q.range === "24h" ? "24 hours ago" : q.range === "7d" ? "7 days ago" : "30 days ago";

  return [
    "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin",
    "LOW='nice -n 19'",
    "command -v ionice >/dev/null 2>&1 && LOW='ionice -c3 nice -n 19'",
    "TO=''; command -v timeout >/dev/null 2>&1 && TO='timeout 15'",
    "echo @@traffic",
    "if command -v python3 >/dev/null 2>&1; then",
    "  py=$(mktemp)",
    "  trap 'rm -f \"$py\"' EXIT",
    "  cat <<'__SSHORUS_PY__' > \"$py\"",
    PY_ANALYZER,
    "__SSHORUS_PY__",
    journal
      ? `  if command -v journalctl >/dev/null 2>&1; then $TO $LOW journalctl -u caddy --since ${shQuote(sinceArg)} --no-pager -o cat 2>/dev/null | $TO $LOW python3 "$py" ${pyArgs}; else echo '{"error":"journalctl no está disponible en este servidor"}'; fi`
      : `  $TO $LOW python3 "$py" ${pyArgs}`,
    "else",
    `  echo '{"error":"Hace falta python3 en el servidor para analizar los logs de visitas"}'`,
    "fi",
    "echo @@end",
  ].join("\n");
}

/** Interpreta la salida de `trafficScript`. Lanza Error con mensaje legible si el script falló. */
export function parseTraffic(stdout: string, sharedLog: boolean): TrafficReport {
  const m = /@@traffic\r?\n([\s\S]*?)\r?\n@@end/.exec(stdout);
  const raw = (m ? m[1] : stdout).trim();
  if (!raw) throw new Error("El servidor no devolvió datos de tráfico.");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`No se pudo leer el resumen de tráfico: ${raw.slice(0, 200)}`);
  }
  if (typeof data.error === "string" && data.error) throw new Error(data.error);
  const report = data as unknown as TrafficReport;
  return {
    ...report,
    meta: {
      ...report.meta,
      sharedLog,
    },
  };
}
