// Para los puertos que no se reconocen: ¿responden como una web? Se pregunta desde el propio servidor con
// `curl -sI` (solo la cabecera, máx. 2 s por intento, todos a la vez en una sola ejecución).
// Sin curl, quedan como «Otro».
import { splitSections } from "../admin/parse";
import { WEB_GUESS } from "./catalog";
import type { FoundService } from "./detect";

/** Como mucho tantos puertos por búsqueda (cada uno son dos peticiones cortas). */
const MAX_PROBES = 24;
/** Solo direcciones IP: el host acaba dentro de un comando. */
const SAFE_HOST = /^[0-9a-fA-F.:]+$/;

export type HttpScheme = "http" | "https";

function targets(services: FoundService[]): FoundService[] {
  return services.filter((s) => !s.service && SAFE_HOST.test(s.destHost)).slice(0, MAX_PROBES);
}

function urlHost(h: string): string {
  return h.includes(":") ? `[${h}]` : h;
}

const CURL = "curl -skI -o /dev/null -w '%{http_code}' --max-time 2";

/**
 * Script que pregunta a cada puerto sin reconocer, todos a la vez. Primero http; https solo si http no
 * contesta o da 400 (lo típico de un servidor solo-https). Salida: «clave códigoHttp códigoHttps».
 * null = no hay nada que probar.
 */
export function httpProbeScript(services: FoundService[]): string | null {
  const list = targets(services);
  if (list.length === 0) return null;
  const lines = list.map((s) => {
    const addr = `${urlHost(s.destHost)}:${s.port}/`;
    return (
      `(c=$(${CURL} http://${addr} 2>/dev/null); h=000; ` +
      `case "$c" in 000|400) h=$(${CURL} https://${addr} 2>/dev/null);; esac; echo "${s.key} $c $h") &`
    );
  });
  return ["echo @@http", "if command -v curl >/dev/null 2>&1; then", ...lines, "wait", "fi", "echo @@end"].join("\n");
}

/** Qué puertos respondieron como web (clave `destHost:puerto` → esquema). «000» = no contestó como web. */
export function parseHttpProbe(stdout: string): Map<string, HttpScheme> {
  const out = new Map<string, HttpScheme>();
  for (const line of splitSections(stdout).get("http") ?? []) {
    const m = /^(\S+) (\d{3}) (\d{3})$/.exec(line.trim());
    if (!m) continue;
    if (m[3] !== "000") out.set(m[1], "https");
    else if (m[2] !== "000") out.set(m[1], "http");
  }
  return out;
}

/** Los que respondieron pasan a «Web / panel» (adivinado). */
export function applyHttpProbe(services: FoundService[], web: Map<string, HttpScheme>): FoundService[] {
  return services.map((s) => {
    const scheme = !s.service ? web.get(s.key) : undefined;
    return scheme ? { ...s, service: WEB_GUESS[scheme], guessed: true } : s;
  });
}
