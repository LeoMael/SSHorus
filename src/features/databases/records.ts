// Salida «por registros» de los tres clientes y citas de SQL. Funciones puras.
//
// Los tres clientes escriben lo mismo: cada fila es un registro que termina en RS (0x1E) con sus campos
// separados por US (0x1F), y el primer campo dice qué es («T» tabla, «C» columna…):
// - psql: `-At -F <US> -R <RS>` (sin cabeceras ni alineado).
// - mysql/mariadb: `--batch --raw -N` y cada SELECT arma su fila con CONCAT_WS(US, …) y RS al final.
// - sqlite3: `-ascii` (usa justo esos separadores).
// Así los valores pueden llevar tabuladores, saltos de línea o «|» sin romper nada.

export const US = "\x1f";
export const RS = "\x1e";

/**
 * Fin de un registro: RS o, en psql, el salto de línea con que cierra cada consulta (no pone RS tras la
 * última fila) seguido de la etiqueta del registro siguiente. US nunca aparece en los datos, así que
 * «\n<etiqueta><US>» solo puede ser un límite.
 */
const RECORD_END = /\x1e|\r?\n(?=[A-Z]\x1f)/;

/** Registros de la salida: cada uno, sus campos. Ignora lo que no empiece por una etiqueta conocida. */
export function parseRecords(stdout: string, tags: ReadonlySet<string>): string[][] {
  const out: string[][] = [];
  const parts = stdout.replace(/\r?\n$/, "").split(RECORD_END);
  for (const raw of parts) {
    // mysql pone un salto de línea tras cada RS.
    const rec = raw.replace(/^[\r\n]+/, "");
    if (!rec) continue;
    const f = rec.split(US);
    if (tags.has(f[0])) out.push(f);
  }
  return out;
}

/** Entero de un campo (null si está vacío, no es un número o es negativo: «sin dato»). */
export function intField(s: string | undefined): number | null {
  if (s === undefined || !/^-?\d+(\.\d+)?(e\+?\d+)?$/i.test(s.trim())) return null;
  const n = Math.round(Number(s));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** «1»/«t»/«true»/«YES» → true. */
export function boolField(s: string | undefined): boolean {
  return /^(1|t|true|yes)$/i.test((s ?? "").trim());
}

// ───────── Citas de SQL ─────────

/** Nombres aceptados: sin saltos de línea ni caracteres nulos (el SQL va en un heredoc del shell). */
export function validName(s: string): boolean {
  return s.length > 0 && s.length <= 255 && !/[\n\r\0]/.test(s);
}

function checked(s: string): string {
  if (!validName(s)) throw new Error("Nombre no válido (sin saltos de línea, de 1 a 255 caracteres)");
  return s;
}

/** Literal de texto de PostgreSQL y SQLite: '…' con las comillas dobladas. */
export function sqlString(s: string): string {
  return `'${checked(s).replace(/'/g, "''")}'`;
}

/** Literal de texto de MySQL/MariaDB: además, la barra invertida es un escape. */
export function mysqlString(s: string): string {
  return `'${checked(s).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

/** Identificador de PostgreSQL y SQLite: "…" con las comillas dobles dobladas. */
export function sqlIdent(s: string): string {
  return `"${checked(s).replace(/"/g, '""')}"`;
}

/** Identificador de MySQL/MariaDB: `…` con los acentos graves doblados. */
export function mysqlIdent(s: string): string {
  return `\`${checked(s).replace(/`/g, "``")}\``;
}

/** Valor de una cadena de conexión de libpq (`dbname='…'`): comillas y barras con barra invertida. */
export function pgConnValue(s: string): string {
  return `'${checked(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
