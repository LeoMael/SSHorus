// Salida en vivo de las tareas de Compose y de descargar una imagen: qué líneas de progreso se juntan
// (cada capa de una imagen, cada contenedor «Creating… Created… Started»: se ve solo su último estado),
// los logs de Podman en texto llano y el ruido que se quita. Funciones puras; la salida en sí la lleva
// features/jobs/output.ts.
import type { OutputRules } from "../jobs/output";

/** Estados que Compose escribe tras el nombre de un contenedor, imagen, red, volumen o servicio. */
const STATE_WORDS =
  "Pulling|Pulled|Building|Built|Creating|Created|Recreate|Recreated|Starting|Started|Running|Stopping|Stopped|Removing|Removed|Waiting|Healthy|Skipped|Interrupted|Warning|Error|Exporting|Exported|Naming|Unpacking";
/** «Container x Creating», «Image y Pulled 3.2s», «Container x Error response from daemon…». */
const ENTITY_RE = new RegExp(`^(?:[✔✘!⠀-⣿]\\s*)?(Container|Image|Network|Volume|Service)\\s+(\\S+)\\s+(?:${STATE_WORDS})\\b`, "u");
/** Formato corto, sin tipo: «db Pulling», «✔ db Pulled 12.3s» (solo eso en la línea). */
const SERVICE_RE = new RegExp(`^(?:[✔✘!⠀-⣿]\\s*)?([a-zA-Z0-9][a-zA-Z0-9_.-]*)\\s+(?:${STATE_WORDS})(?:\\s+[\\d.]+m?s)?$`, "u");
/** Capa de imagen de Docker / Compose: «1a2b3c4d5e6f Downloading [==>  ] 1MB/5MB». */
const LAYER_RE =
  /^(?:[✔✘⠀-⣿]\s*)?([0-9a-f]{12})\s+(?:Pulling fs layer|Waiting|Downloading|Verifying Checksum|Download complete|Extracting|Pull complete|Already exists)\b/u;
/** Capa de imagen de Podman: «Copying blob sha256:1a2b… done», «Copying config 1a2b… [===>]». */
const PODMAN_BLOB_RE = /^Copying (blob|config) (?:sha256:)?([0-9a-f]{12,64})\b/;

/** Clave de una línea de progreso (las de la misma clave se juntan), o null si es una línea normal. */
export function progressKey(line: string): string | null {
  const t = line.trim();
  let m = PODMAN_BLOB_RE.exec(t);
  if (m) return `${m[1]}:${m[2].slice(0, 12)}`;
  m = LAYER_RE.exec(t);
  if (m) return `layer:${m[1]}`;
  m = ENTITY_RE.exec(t);
  if (m) return `${m[1].toLowerCase()}:${m[2]}`;
  m = SERVICE_RE.exec(t);
  if (m) return `service:${m[1]}`;
  return null;
}

/** Líneas que no aportan nada (avisos de Podman al pasar el trabajo a docker-compose). */
const NOISE_RE = /Executing external compose provider|Please see podman-compose|^>>>> /;

/** Línea de log de Podman (`time="…" level=warning msg="…"`) en texto llano; null si es ruido. */
export function composeLine(line: string): string | null {
  if (NOISE_RE.test(line)) return null;
  const m = /^time="[^"]*" level=(\w+) msg="(.*)"$/.exec(line);
  if (!m) return line;
  const msg = m[2].replace(/\\"/g, '"');
  return m[1] === "warning" ? `Aviso: ${msg}` : m[1] === "error" || m[1] === "fatal" ? `Error: ${msg}` : msg;
}

export const COMPOSE_OUTPUT: OutputRules = { progressKey, mapLine: composeLine };
