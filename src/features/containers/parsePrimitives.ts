// Primitivas puras de parseo para Podman y Docker (JSON, tamaños, fechas, estados y puertos).
import type { Container, ContainerState, PortMapping } from "./types";

export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Acepta un array JSON, un objeto suelto o una línea JSON por elemento (ignora líneas basura). */
export function parseJsonList(text: string): Obj[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith("[")) {
    try {
      const v: unknown = JSON.parse(t);
      if (Array.isArray(v)) return v.filter(isObj);
    } catch {
      // Puede ser varias líneas que empiezan por "[" (raro): se prueba línea a línea.
    }
  }
  const out: Obj[] = [];
  for (const raw of t.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{") && !line.startsWith("[")) continue;
    try {
      const v: unknown = JSON.parse(line);
      if (Array.isArray(v)) out.push(...v.filter(isObj));
      else if (isObj(v)) out.push(v);
    } catch {
      // línea no válida: se ignora
    }
  }
  if (out.length === 0 && t.startsWith("{")) {
    try {
      const v: unknown = JSON.parse(t);
      if (isObj(v)) out.push(v);
    } catch {
      // nada
    }
  }
  return out;
}

/** Primer campo presente (sin distinguir mayúsculas). */
export function pick(o: Obj, ...keys: string[]): unknown {
  for (const k of keys) if (k in o && o[k] !== undefined) return o[k];
  const lower = new Map(Object.keys(o).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase());
    if (real !== undefined && o[real] !== undefined) return o[real];
  }
  return undefined;
}

export function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

export function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

/** Etiquetas: objeto (Podman) o "k=v,k2=v2" (Docker; los valores pueden llevar comas). */
export function parseLabels(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isObj(v)) {
    for (const [k, val] of Object.entries(v)) out[k] = str(val);
    return out;
  }
  if (typeof v !== "string" || !v.trim()) return out;
  // Separa por comas que van seguidas de «clave=» (clave sin espacios ni comas).
  const parts = v.split(/,(?=[^,=\s]+=)/);
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i <= 0) continue;
    out[p.slice(0, i).trim()] = p.slice(i + 1);
  }
  return out;
}

/** "187MB", "1.2 GB", "9.5MiB", "0B", "10.01GB (58%)" → bytes. Docker usa unidades decimales (kB, MB). */
export function parseSize(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = /^\s*([\d.]+)\s*([kKMGTP]?i?B?)\b/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2];
  const bin = unit.includes("i");
  const base = bin ? 1024 : 1000;
  const p = { "": 0, k: 1, K: 1, M: 2, G: 3, T: 4, P: 5 }[unit.replace(/i?B?$/, "")] ?? 0;
  return Math.round(n * base ** p);
}

/** "12.5%" → 12.5 */
export function parsePercent(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = /([\d.]+)\s*%/.exec(v);
  return m ? Number(m[1]) : num(v);
}

/**
 * Fechas: número unix (s o ns), ISO 8601, o el formato de Docker "2024-01-15 10:00:00 +0000 UTC".
 * Devuelve unix segundos o null. Las fechas «cero» (0001-01-01, negativas) son null.
 */
export function parseTime(v: unknown): number | null {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0) return null;
    if (v > 1e17) return Math.floor(v / 1e9); // nanosegundos
    if (v > 1e11) return Math.floor(v / 1e3); // milisegundos
    return Math.floor(v);
  }
  if (typeof v !== "string" || !v.trim()) return null;
  let s = v.trim();
  if (/^\d+$/.test(s)) return parseTime(Number(s));
  // Docker: "2024-01-15 10:00:00 +0000 UTC" (puede llevar fracciones de segundo).
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})?/.exec(s);
  if (m) s = `${m[1]}T${m[2]}${m[3]}:${m[4] ?? "00"}`;
  else s = s.replace(/(\.\d{3})\d+/, "$1");
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const secs = Math.floor(t / 1000);
  return secs > 0 ? secs : null;
}

const STATE_MAP: Record<string, ContainerState> = {
  running: "running",
  up: "running",
  paused: "paused",
  exited: "exited",
  stopped: "exited",
  stopping: "running",
  configured: "created",
  initialized: "created",
  created: "created",
  restarting: "restarting",
  removing: "removing",
  dead: "dead",
};

export function normalizeState(state: string, status = ""): ContainerState {
  const s = state.toLowerCase().trim();
  if (STATE_MAP[s]) return STATE_MAP[s];
  const st = status.toLowerCase();
  if (st.startsWith("up")) return st.includes("paused") ? "paused" : "running";
  if (st.startsWith("exited")) return "exited";
  if (st.startsWith("created")) return "created";
  if (st.startsWith("restarting")) return "restarting";
  return "unknown";
}

export function healthOf(status: string): Container["health"] {
  const s = status.toLowerCase();
  if (s.includes("(healthy)")) return "healthy";
  if (s.includes("(unhealthy)")) return "unhealthy";
  if (s.includes("health: starting") || s.includes("(starting)")) return "starting";
  return null;
}

/**
 * Puertos de Docker: "0.0.0.0:8080->80/tcp, :::8080->80/tcp, 443/tcp, 127.0.0.1:8000-8002->8000-8002/tcp".
 * Las entradas IPv6 duplicadas de un mismo puerto se juntan.
 */
export function parsePortsString(s: string): PortMapping[] {
  const out: PortMapping[] = [];
  const seen = new Set<string>();
  for (const raw of s.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    let m = /^(?:(.*):)?(\d+)(?:-(\d+))?->(\d+)(?:-(\d+))?\/(\w+)$/.exec(part);
    if (m) {
      let ip = m[1] ?? "";
      if (ip === "0.0.0.0" || ip === "::" || ip === "[::]") ip = "";
      ip = ip.replace(/^\[|\]$/g, "");
      const hostPort = Number(m[2]);
      const range = m[3] ? Number(m[3]) - hostPort + 1 : 1;
      const key = `${ip}|${hostPort}|${m[4]}|${m[6]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ hostIp: ip, hostPort, containerPort: Number(m[4]), protocol: m[6], range });
      continue;
    }
    m = /^(\d+)(?:-(\d+))?\/(\w+)$/.exec(part);
    if (m) {
      const key = `x|${m[1]}|${m[3]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        hostIp: "",
        hostPort: null,
        containerPort: Number(m[1]),
        protocol: m[3],
        range: m[2] ? Number(m[2]) - Number(m[1]) + 1 : 1,
      });
    }
  }
  return out;
}

export function parsePorts(v: unknown): PortMapping[] {
  if (typeof v === "string") return parsePortsString(v);
  if (!Array.isArray(v)) return [];
  const out: PortMapping[] = [];
  for (const p of v) {
    if (!isObj(p)) continue;
    const cp = num(pick(p, "container_port", "containerPort", "PrivatePort"));
    if (cp === null) continue;
    let ip = str(pick(p, "host_ip", "hostIP", "IP"));
    if (ip === "0.0.0.0" || ip === "::") ip = "";
    out.push({
      hostIp: ip,
      hostPort: num(pick(p, "host_port", "hostPort", "PublicPort")),
      containerPort: cp,
      protocol: str(pick(p, "protocol", "Type")) || "tcp",
      range: num(pick(p, "range")) ?? 1,
    });
  }
  return out;
}
