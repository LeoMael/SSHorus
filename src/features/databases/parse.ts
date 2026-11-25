// Lectura de la salida de los clientes: lista de bases, esquema, DDL y qué significa cada error.
// Funciones puras.
import { RECORD_TAGS } from "./queries";
import { RS, boolField, intField, parseRecords } from "./records";
import { EXIT_NO_CLIENT } from "./scripts";
import type { DbColumn, DbForeignKey, DbList, DbSchema, DbTable, DbTableKind } from "./types";

const KIND: Record<string, DbTableKind> = { r: "table", v: "view", m: "matview", f: "foreign", p: "partitioned" };

export function parseDatabases(stdout: string): DbList {
  const out: DbList = { version: null, databases: [] };
  for (const f of parseRecords(stdout, RECORD_TAGS)) {
    if (f[0] === "V") out.version = f[1] ?? null;
    else if (f[0] === "D" && f[1]) out.databases.push({ name: f[1], bytes: intField(f[2]) });
  }
  return out;
}

const tableKey = (schema: string, name: string) => `${schema}\u0000${name}`;

export function parseSchema(stdout: string, database: string, truncated = false): DbSchema {
  const schema: DbSchema = { database, version: null, tables: [], truncated };
  const byKey = new Map<string, DbTable>();
  const fks = new Map<string, DbForeignKey>();
  const pks = new Map<string, Set<string>>();
  const columns: [string, DbColumn][] = [];
  for (const f of parseRecords(stdout, RECORD_TAGS)) {
    const [tag, s = "", t = ""] = f;
    const key = tableKey(s, t);
    switch (tag) {
      case "V":
        schema.version = s || null;
        break;
      case "T": {
        const table: DbTable = {
          schema: s,
          name: t,
          kind: KIND[f[3]] ?? "table",
          rows: intField(f[4]),
          bytes: intField(f[5]),
          comment: f[6] ?? "",
          columns: [],
          indexes: [],
          foreignKeys: [],
        };
        byKey.set(key, table);
        schema.tables.push(table);
        break;
      }
      case "C":
        columns.push([key, { name: f[4] ?? "", type: f[5] ?? "", nullable: boolField(f[6]), default: boolField(f[7]) ? (f[8] ?? "") : null, pk: false }]);
        break;
      case "K":
        pks.set(key, (pks.get(key) ?? new Set()).add(f[3] ?? ""));
        break;
      case "I":
        byKey.get(key)?.indexes.push({ name: f[3] ?? "", unique: boolField(f[4]), primary: boolField(f[5]), columns: f[6] ?? "" });
        break;
      case "F": {
        const fkKey = `${key}\u0000${f[3]}`;
        let fk = fks.get(fkKey);
        if (!fk) {
          fk = { name: f[3] ?? "", columns: [], refSchema: f[6] ?? "", refTable: f[7] ?? "", refColumns: [] };
          fks.set(fkKey, fk);
          byKey.get(key)?.foreignKeys.push(fk);
        }
        fk.columns.push(f[5] ?? "");
        fk.refColumns.push(f[8] ?? "");
        break;
      }
    }
  }
  for (const [key, col] of columns) {
    const table = byKey.get(key);
    if (!table) continue;
    col.pk = pks.get(key)?.has(col.name) ?? false;
    table.columns.push(col);
  }
  return schema;
}

/** pg_dump sin comentarios, `SET …` ni líneas en blanco de más. */
function cleanPgDump(out: string): string {
  return out
    .split("\n")
    .filter((l) => !l.startsWith("--") && !/^SET |^SELECT pg_catalog\.set_config/.test(l) && !/^\\(un)?restrict /.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Texto del DDL según el motor. */
export function parseDdl(engine: "postgres" | "mysql" | "sqlite", stdout: string): string {
  if (engine === "postgres") return cleanPgDump(stdout);
  if (engine === "sqlite") return stdout.split(RS).map((s) => s.replace(/^[\r\n]+/, "").trim()).filter(Boolean).join("\n\n");
  // SHOW CREATE TABLE: «nombre<TAB>CREATE …» (en vistas siguen más columnas separadas por TAB).
  const line = stdout.replace(/\r/g, "");
  const tab = line.indexOf("\t");
  if (tab < 0) return line.trim();
  const rest = line.slice(tab + 1);
  const view = /^CREATE (ALGORITHM|DEFINER|SQL SECURITY|VIEW)/i.test(rest);
  return `${(view ? rest.split("\t")[0] : rest).trim()};`;
}

export type DbErrorKind = "auth" | "no-client" | "no-database" | "no-file" | "unreachable" | "permission" | "other";

const ERROR_RULES: [RegExp, DbErrorKind][] = [
  [/sshorus: falta el programa|command not found|executable file not found|not found in \$path/i, "no-client"],
  [/sshorus: no existe el archivo/, "no-file"],
  [
    /password authentication failed|peer authentication failed|ident authentication failed|no password supplied|fe_sendauth|role "[^"]*" does not exist|access denied for user|authentication failed|using password: no|no pg_hba\.conf entry|autentificaci[oó]n .*fall[oó]|el rol «[^»]*» no existe|no se entregó una contraseña/i,
    "auth",
  ],
  [/database "[^"]*" does not exist|unknown database|la base de datos «[^»]*» no existe/i, "no-database"],
  [/could not connect to server|connection refused|can't connect to (local )?(mysql|mariadb|server)|no such file or directory|is the server running|timeout expired|connection timed out/i, "unreachable"],
  [/permission denied|unable to open database file|is not a database|file is not a database/i, "permission"],
];

/** Qué tipo de error es (para decidir si probar otra forma de entrar o pedir usuario y contraseña). */
export function classifyError(exitCode: number | null, stderr: string): DbErrorKind {
  for (const [re, kind] of ERROR_RULES) if (re.test(stderr)) return kind;
  if (exitCode === EXIT_NO_CLIENT) return "no-client";
  return "other";
}

const ERROR_TEXT: Record<DbErrorKind, string> = {
  auth: "La base de datos no aceptó el usuario o la contraseña",
  "no-client": "Falta el programa cliente en el servidor (psql, mysql/mariadb o sqlite3)",
  "no-database": "Esa base de datos no existe",
  "no-file": "Ese archivo no existe en el servidor",
  unreachable: "No se pudo conectar con la base de datos (¿está en marcha?)",
  permission: "Sin permiso para leer la base de datos",
  other: "No se pudo leer la base de datos",
};

/** Mensaje en español con el detalle original (sin «sshorus:» y recortado). */
export function errorText(kind: DbErrorKind, stderr: string): string {
  const raw = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("sshorus:"))
    .slice(-4)
    .join("\n");
  return raw ? `${ERROR_TEXT[kind]}.\n\n${raw}` : `${ERROR_TEXT[kind]}.`;
}
