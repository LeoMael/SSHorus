// Salida en vivo de las tareas largas (Compose up/pull/build, descargar imagen). Funciones puras.
//
// La salida llega a trozos. Las líneas de progreso repetidas (cada capa de una imagen, cada
// contenedor «Creating… Created… Started») se juntan en una sola: se ve solo el último estado de cada una.

/** Líneas que se guardan como máximo (las más viejas se descartan). */
export const MAX_JOB_LINES = 2000;
/** Segundos sin salida nueva a partir de los que se avisa. */
export const STALL_SECS = 60;

// Secuencias de escape de color y movimiento del cursor.
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

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

/** Lo que se ve de una línea: sin colores y, si se redibuja con «\r», solo el último dibujo. */
export function cleanLine(raw: string): string {
  const parts = raw.replace(ANSI_RE, "").split("\r");
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].trim()) return logText(parts[i].trimEnd());
  return "";
}

/** Línea de log de Podman (`time="…" level=warning msg="…"`) en texto llano. */
function logText(line: string): string {
  const m = /^time="[^"]*" level=(\w+) msg="(.*)"$/.exec(line);
  if (!m) return line;
  const msg = m[2].replace(/\\"/g, '"');
  return m[1] === "warning" ? `Aviso: ${msg}` : m[1] === "error" || m[1] === "fatal" ? `Error: ${msg}` : msg;
}

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

/** Salida acumulada de una tarea. Se usa por dentro de la tarea; la interfaz recibe `view()`. */
export class JobOutput {
  private lines: string[] = [];
  private keys: (string | null)[] = [];
  private index = new Map<string, number>();
  private partial = "";
  /** Líneas viejas que ya no se guardan. */
  dropped = 0;

  /** Añade un trozo de salida tal y como llega. */
  push(chunk: string): void {
    const text = this.partial + chunk.replace(/\r\n/g, "\n");
    const parts = text.split("\n");
    this.partial = parts.pop() ?? "";
    for (const p of parts) this.add(p);
  }

  /** Fin de la salida: la última línea sin «\n» también cuenta. */
  end(): void {
    if (this.partial) this.add(this.partial);
    this.partial = "";
  }

  private add(raw: string): void {
    const line = cleanLine(raw);
    if (!line || NOISE_RE.test(line)) return;
    const key = progressKey(line);
    const at = key !== null ? this.index.get(key) : undefined;
    if (at !== undefined) {
      this.lines[at] = line;
      return;
    }
    this.lines.push(line);
    this.keys.push(key);
    if (key !== null) this.index.set(key, this.lines.length - 1);
    if (this.lines.length > MAX_JOB_LINES + 200) this.trim();
  }

  private trim(): void {
    const cut = this.lines.length - MAX_JOB_LINES;
    this.lines = this.lines.slice(cut);
    this.keys = this.keys.slice(cut);
    this.dropped += cut;
    this.index = new Map();
    this.keys.forEach((k, i) => k !== null && this.index.set(k, i));
  }

  /** Lo que se ve ahora (la línea a medias también, p. ej. una barra de progreso con «\r»). */
  view(): string[] {
    const tail = this.partial ? cleanLine(this.partial) : "";
    return tail && !NOISE_RE.test(tail) ? [...this.lines, tail] : [...this.lines];
  }
}

/** Aviso cuando una tarea lleva un rato sin escribir nada (null = todo normal). */
export function stallText(idleSecs: number): string | null {
  if (idleSecs < STALL_SECS) return null;
  const min = Math.floor(idleSecs / 60);
  return `Sin salida nueva desde hace ${min} min — puede estar descargando o atascado`;
}
