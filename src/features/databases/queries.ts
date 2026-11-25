// Consultas de solo lectura (pg_catalog, information_schema y sqlite_master) que leen el esquema.
// Funciones puras. Cada fila sale como un registro con su etiqueta (ver records.ts):
//   V versión · D base, bytes · T esquema, tabla, tipo (r v m f p), filas, bytes, comentario
//   C esquema, tabla, posición, columna, tipo, admite nulo, tiene valor por defecto, valor por defecto
//   K esquema, tabla, columna (clave primaria, en orden) · I esquema, tabla, índice, único, primario, columnas
//   F esquema, tabla, nombre, posición, columna, esquema destino, tabla destino, columna destino
import { mysqlIdent, mysqlString, sqlIdent, sqlString } from "./records";
import type { DbEngine } from "./types";

export const RECORD_TAGS: ReadonlySet<string> = new Set(["V", "D", "T", "C", "K", "I", "F"]);

/** Filtro opcional (MCP): solo un esquema o una tabla. */
export interface SchemaFilter {
  schema?: string | null;
  table?: string | null;
}

/** «AND col = 'valor'» si hay valor. */
function eq(col: string, value: string | null | undefined, lit: (s: string) => string): string {
  return value ? ` AND ${col} = ${lit(value)}` : "";
}

// ───────── PostgreSQL ─────────

/** Esquemas del usuario (fuera los del sistema: pg_catalog, pg_toast, pg_temp_N e information_schema). */
const PG_NS = "n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'";
const PG_KINDS = "('r','v','m','f','p')";

function pgDatabases(): string {
  return [
    "SELECT 'V', current_setting('server_version');",
    "SELECT 'D', datname, CASE WHEN has_database_privilege(datname, 'CONNECT') THEN pg_database_size(datname) ELSE -1 END",
    "  FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY 2;",
  ].join("\n");
}

function pgSchema(f: SchemaFilter): string {
  const ns = `${PG_NS}${eq("n.nspname", f.schema, sqlString)}`;
  const rel = (alias: string) => eq(`${alias}.relname`, f.table, sqlString);
  return [
    "SELECT 'V', current_setting('server_version');",
    "SELECT 'T', n.nspname, c.relname, c.relkind, c.reltuples::bigint, pg_total_relation_size(c.oid), coalesce(obj_description(c.oid, 'pg_class'), '')",
    `  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace`,
    `  WHERE c.relkind IN ${PG_KINDS} AND NOT c.relispartition AND ${ns}${rel("c")} ORDER BY 2, 3;`,
    "SELECT 'C', n.nspname, c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod),",
    "  CASE WHEN a.attnotnull THEN 0 ELSE 1 END, CASE WHEN d.adbin IS NULL THEN 0 ELSE 1 END, coalesce(pg_get_expr(d.adbin, d.adrelid), '')",
    "  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace",
    "  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum",
    `  WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ${PG_KINDS} AND NOT c.relispartition AND ${ns}${rel("c")} ORDER BY 2, 3, 4;`,
    "SELECT 'K', n.nspname, t.relname, a.attname",
    "  FROM pg_index x JOIN pg_class t ON t.oid = x.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace",
    "  CROSS JOIN LATERAL unnest(x.indkey::int2[]) WITH ORDINALITY k(attnum, ord)",
    "  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum",
    `  WHERE x.indisprimary AND ${ns}${rel("t")} ORDER BY 2, 3, k.ord;`,
    "SELECT 'I', n.nspname, t.relname, i.relname, CASE WHEN x.indisunique THEN 1 ELSE 0 END, CASE WHEN x.indisprimary THEN 1 ELSE 0 END,",
    "  regexp_replace(pg_get_indexdef(x.indexrelid), '^.* USING ', '')",
    "  FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace",
    `  WHERE ${ns}${rel("t")} ORDER BY 2, 3, 4;`,
    "SELECT 'F', n.nspname, t.relname, co.conname, k.ord, a.attname, rn.nspname, rt.relname, ra.attname",
    "  FROM pg_constraint co JOIN pg_class t ON t.oid = co.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace",
    "  JOIN pg_class rt ON rt.oid = co.confrelid JOIN pg_namespace rn ON rn.oid = rt.relnamespace",
    "  CROSS JOIN LATERAL unnest(co.conkey, co.confkey) WITH ORDINALITY k(att, ratt, ord)",
    "  JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = k.att",
    "  JOIN pg_attribute ra ON ra.attrelid = co.confrelid AND ra.attnum = k.ratt",
    `  WHERE co.contype = 'f' AND ${ns}${rel("t")} ORDER BY 2, 3, 4, 5;`,
  ].join("\n");
}

// ───────── MySQL / MariaDB ─────────

const MY_US = "CHAR(31 USING utf8mb4)";
const MY_RS = "CHAR(30 USING utf8mb4)";
/** Bases del sistema que no se muestran. */
const MY_SYSTEM = "('information_schema','performance_schema','sys','mysql')";

/** Una fila: «etiqueta, campos…» unidos por US y terminada en RS (CONCAT_WS se salta los NULL: IFNULL). */
function myRow(tag: string, fields: string[]): string {
  return `CONCAT(CONCAT_WS(${MY_US}, '${tag}', ${fields.map((x) => `IFNULL(${x}, '')`).join(", ")}), ${MY_RS})`;
}

function myDatabases(): string {
  const size = "(SELECT SUM(t.DATA_LENGTH + t.INDEX_LENGTH) FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA = s.SCHEMA_NAME)";
  return [
    `SELECT ${myRow("V", ["VERSION()"])};`,
    `SELECT ${myRow("D", ["s.SCHEMA_NAME", `IFNULL(${size}, 0)`])} FROM information_schema.SCHEMATA s`,
    `  WHERE s.SCHEMA_NAME NOT IN ${MY_SYSTEM} ORDER BY s.SCHEMA_NAME;`,
  ].join("\n");
}

function mySchema(database: string, f: SchemaFilter): string {
  const db = mysqlString(database);
  const t = (col: string) => eq(col, f.table, mysqlString);
  return [
    `SELECT ${myRow("V", ["VERSION()"])};`,
    `SELECT ${myRow("T", [
      "TABLE_SCHEMA",
      "TABLE_NAME",
      "IF(TABLE_TYPE = 'VIEW', 'v', 'r')",
      "TABLE_ROWS",
      "DATA_LENGTH + INDEX_LENGTH",
      "IF(TABLE_TYPE = 'VIEW', '', TABLE_COMMENT)",
    ])}`,
    `  FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${db}${t("TABLE_NAME")} ORDER BY TABLE_NAME;`,
    `SELECT ${myRow("C", [
      "TABLE_SCHEMA",
      "TABLE_NAME",
      "ORDINAL_POSITION",
      "COLUMN_NAME",
      "IF(EXTRA = '', COLUMN_TYPE, CONCAT(COLUMN_TYPE, ' ', EXTRA))",
      "IF(IS_NULLABLE = 'YES', 1, 0)",
      "IF(COLUMN_DEFAULT IS NULL, 0, 1)",
      "COLUMN_DEFAULT",
    ])}`,
    `  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${db}${t("TABLE_NAME")} ORDER BY TABLE_NAME, ORDINAL_POSITION;`,
    `SELECT ${myRow("K", ["TABLE_SCHEMA", "TABLE_NAME", "COLUMN_NAME"])}`,
    `  FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ${db} AND CONSTRAINT_NAME = 'PRIMARY'${t("TABLE_NAME")}`,
    "  ORDER BY TABLE_NAME, ORDINAL_POSITION;",
    `SELECT ${myRow("I", [
      "TABLE_SCHEMA",
      "TABLE_NAME",
      "INDEX_NAME",
      "IF(MIN(NON_UNIQUE) = 0, 1, 0)",
      "IF(INDEX_NAME = 'PRIMARY', 1, 0)",
      "CONCAT(LOWER(MIN(INDEX_TYPE)), ' (', GROUP_CONCAT(IFNULL(COLUMN_NAME, '(expresión)') ORDER BY SEQ_IN_INDEX SEPARATOR ', '), ')')",
    ])}`,
    `  FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ${db}${t("TABLE_NAME")}`,
    "  GROUP BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME ORDER BY TABLE_NAME, INDEX_NAME;",
    `SELECT ${myRow("F", [
      "TABLE_SCHEMA",
      "TABLE_NAME",
      "CONSTRAINT_NAME",
      "ORDINAL_POSITION",
      "COLUMN_NAME",
      "REFERENCED_TABLE_SCHEMA",
      "REFERENCED_TABLE_NAME",
      "REFERENCED_COLUMN_NAME",
    ])}`,
    `  FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ${db} AND REFERENCED_TABLE_NAME IS NOT NULL${t("TABLE_NAME")}`,
    "  ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION;",
  ].join("\n");
}

// ───────── SQLite ─────────

function liteSchema(f: SchemaFilter): string {
  const name = (col: string) => eq(col, f.table, sqlString);
  const tables = `m.type IN ('table','view') AND m.name NOT LIKE 'sqlite_%'${name("m.name")}`;
  return [
    ".timeout 5000",
    "SELECT 'V', sqlite_version();",
    "SELECT 'T', 'main', m.name, CASE m.type WHEN 'view' THEN 'v' ELSE 'r' END, '', '', '' FROM sqlite_master m",
    `  WHERE ${tables} ORDER BY m.name;`,
    "SELECT 'C', 'main', m.name, p.cid + 1, p.name, p.type, CASE WHEN p.\"notnull\" THEN 0 ELSE 1 END,",
    "  CASE WHEN p.dflt_value IS NULL THEN 0 ELSE 1 END, ifnull(p.dflt_value, '')",
    `  FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE ${tables} ORDER BY m.name, p.cid;`,
    "SELECT 'K', 'main', m.name, p.name FROM sqlite_master m JOIN pragma_table_info(m.name) p",
    `  WHERE m.type = 'table' AND p.pk > 0${name("m.name")} ORDER BY m.name, p.pk;`,
    "SELECT 'I', 'main', m.name, il.name, il.\"unique\", CASE WHEN il.origin = 'pk' THEN 1 ELSE 0 END,",
    "  '(' || (SELECT group_concat(ii.name, ', ') FROM pragma_index_info(il.name) ii) || ')'",
    `  FROM sqlite_master m JOIN pragma_index_list(m.name) il WHERE m.type = 'table'${name("m.name")} ORDER BY m.name, il.name;`,
    "SELECT 'F', 'main', m.name, 'fk_' || m.name || '_' || f.id, f.seq + 1, f.\"from\", 'main', f.\"table\", ifnull(f.\"to\", '')",
    `  FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f WHERE m.type = 'table'${name("m.name")} ORDER BY m.name, f.id, f.seq;`,
  ].join("\n");
}

// ───────── Entradas ─────────

/** SQL de la lista de bases (SQLite tiene una sola: no hace falta). */
export function databasesSql(engine: Exclude<DbEngine, "sqlite">): string {
  return engine === "postgres" ? pgDatabases() : myDatabases();
}

/** SQL del esquema de una base. En PostgreSQL la base se elige al conectar (no va en el SQL). */
export function schemaSql(engine: DbEngine, database: string, filter: SchemaFilter = {}): string {
  if (engine === "postgres") return pgSchema(filter);
  if (engine === "mysql") return mySchema(database, filter);
  return liteSchema(filter);
}

/** SQL de «Copiar DDL» en MySQL y SQLite (PostgreSQL usa `pg_dump --schema-only`). */
export function ddlSql(engine: Exclude<DbEngine, "postgres">, database: string, table: string): string {
  if (engine === "mysql") return `SHOW CREATE TABLE ${mysqlIdent(database)}.${mysqlIdent(table)};`;
  return `SELECT sql || ';' FROM sqlite_master WHERE tbl_name = ${sqlString(table)} AND sql IS NOT NULL ORDER BY type DESC, name;`;
}

/** Patrón de `pg_dump -t` para una tabla exacta (entre comillas no hay comodines). */
export function pgDumpPattern(schema: string, table: string): string {
  return `${sqlIdent(schema)}.${sqlIdent(table)}`;
}
