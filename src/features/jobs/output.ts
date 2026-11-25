// Salida en vivo de una tarea en segundo plano. Funciones puras.
//
// La salida llega a trozos. Se quitan colores, de las líneas que se redibujan con «\r» (barras de
// progreso) queda el último dibujo y, si quien lanza la tarea sabe reconocerlas (`progressKey`), las
// líneas de progreso repetidas (cada capa de una imagen, cada contenedor) se juntan en una sola.

/** Líneas que se guardan como máximo (las más viejas se descartan). */
export const MAX_JOB_LINES = 2000;

// Secuencias de escape de color y movimiento del cursor.
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Lo que se ve de una línea: sin colores y, si se redibuja con «\r», solo el último dibujo. */
export function cleanLine(raw: string): string {
  const parts = raw.replace(ANSI_RE, "").split("\r");
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].trim()) return parts[i].trimEnd();
  return "";
}

export interface OutputRules {
  /** Clave de una línea de progreso (las de la misma clave se juntan) o null si es una línea normal. */
  progressKey?: (line: string) => string | null;
  /** Cambia una línea ya limpia; null = no se enseña (ruido). */
  mapLine?: (line: string) => string | null;
}

/** Salida acumulada de una tarea. Se usa por dentro de la tarea; la interfaz recibe `view()`. */
export class JobOutput {
  private lines: string[] = [];
  private keys: (string | null)[] = [];
  private index = new Map<string, number>();
  private partial = "";
  private rules: OutputRules;
  /** Líneas viejas que ya no se guardan. */
  dropped = 0;

  constructor(rules: OutputRules = {}) {
    this.rules = rules;
  }

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

  private shown(raw: string): string | null {
    const line = cleanLine(raw);
    if (!line) return null;
    return this.rules.mapLine ? this.rules.mapLine(line) : line;
  }

  private add(raw: string): void {
    const line = this.shown(raw);
    if (!line) return;
    const key = this.rules.progressKey?.(line) ?? null;
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
    const tail = this.partial ? this.shown(this.partial) : null;
    return tail ? [...this.lines, tail] : [...this.lines];
  }
}
