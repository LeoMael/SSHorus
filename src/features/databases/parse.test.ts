// Pruebas de «Bases de datos»: registros de psql, mysql y sqlite3 (salidas reales de PostgreSQL 17,
// MariaDB 11.4 y SQLite 3), citas de SQL, esquema, DDL y errores.
import { classifyError, errorText, parseDatabases, parseDdl, parseSchema } from "./parse";
import { RECORD_TAGS, ddlSql, pgDumpPattern, schemaSql } from "./queries";
import { intField, mysqlIdent, mysqlString, parseRecords, pgConnValue, sqlIdent, sqlString } from "./records";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function throws(f: () => unknown, what: string) {
  try {
    f();
  } catch {
    passed++;
    return;
  }
  throw new Error(`${what}: debía fallar`);
}

// ── Registros ──
// psql -At -F US -R RS: entre filas RS; al final de cada consulta, un salto de línea (sin RS).
const PG = "V\u001f17.11\nT\u001fventas\u001fpedidos\u001fr\u001f0\u001f8192\u001f\nC\u001fventas\u001fpedidos\u001f1\u001fid\u001fbigint\u001f0\u001f1\u001fnextval('ventas.pedidos_id_seq'::regclass)\u001eC\u001fventas\u001fpedidos\u001f2\u001fcliente_id\u001finteger\u001f0\u001f0\u001f\u001eC\u001fventas\u001fpedidos\u001f3\u001ftotal\u001fnumeric(10,2)\u001f1\u001f0\u001f\nK\u001fventas\u001fpedidos\u001fid\nI\u001fventas\u001fpedidos\u001fpedidos_pkey\u001f1\u001f1\u001fbtree (id)\nF\u001fventas\u001fpedidos\u001fpedidos_cliente_id_fkey\u001f1\u001fcliente_id\u001fpublic\u001fclientes\u001fid\n";
// mysql --batch --raw -N: cada fila termina en RS y salto de línea.
const MY = "V\u001f11.4.13-MariaDB-ubu2404\u001e\nD\u001ftienda\u001f65536\u001e\nD\u001fvacía\u001f0\u001e\n";

eq(parseRecords(PG, RECORD_TAGS).map((f) => f[0]).join(""), "VTCCCKIF", "psql: el salto de línea entre consultas también separa");
eq(parseRecords("basura\u001eX\u001fa\u001eV\u001f1", RECORD_TAGS), [["V", "1"]], "se ignora lo que no tiene etiqueta conocida");
eq(parseRecords("T\u001fs\u001ft\u001fr\u001f\u001f\u001flínea 1\nlínea 2\u001e", RECORD_TAGS)[0][6], "línea 1\nlínea 2", "un valor puede tener saltos de línea");
eq([intField("8192"), intField("-1"), intField(""), intField("1.5e+06"), intField("x")], [8192, null, null, 1500000, null], "enteros (negativo = sin dato)");

// ── Lista de bases ──
eq(parseDatabases(MY), { version: "11.4.13-MariaDB-ubu2404", databases: [{ name: "tienda", bytes: 65536 }, { name: "vacía", bytes: 0 }] }, "mysql: versión y bases");
eq(parseDatabases("V\u001f16.4\nD\u001fapp\u001f-1\u001eD\u001fpostgres\u001f7698099\n").databases, [{ name: "app", bytes: null }, { name: "postgres", bytes: 7698099 }], "pg: sin permiso de CONNECT el tamaño es -1 (sin dato)");

// ── Esquema ──
const s = parseSchema(PG, "tienda");
eq(s.version, "17.11", "versión");
eq(s.tables.length, 1, "una tabla");
const t = s.tables[0];
eq([t.schema, t.name, t.kind, t.rows, t.bytes, t.comment], ["ventas", "pedidos", "table", 0, 8192, ""], "datos de la tabla");
eq(t.columns.map((c) => [c.name, c.type, c.nullable, c.default, c.pk]), [
  ["id", "bigint", false, "nextval('ventas.pedidos_id_seq'::regclass)", true],
  ["cliente_id", "integer", false, null, false],
  ["total", "numeric(10,2)", true, null, false],
], "columnas con nulos, valor por defecto y clave primaria");
eq(t.indexes, [{ name: "pedidos_pkey", unique: true, primary: true, columns: "btree (id)" }], "índice");
eq(t.foreignKeys, [{ name: "pedidos_cliente_id_fkey", columns: ["cliente_id"], refSchema: "public", refTable: "clientes", refColumns: ["id"] }], "clave foránea");

const multi = parseSchema(
  [
    "T\u001fpublic\u001flineas\u001fr\u001f10\u001f100\u001fLíneas\u001e",
    "T\u001fpublic\u001fresumen\u001fv\u001f-1\u001f0\u001f\u001e",
    "C\u001fpublic\u001flineas\u001f1\u001fpedido_id\u001fbigint\u001f0\u001f0\u001f\u001e",
    "C\u001fpublic\u001flineas\u001f2\u001fn\u001fint\u001f0\u001f1\u001f\u001e",
    "C\u001fpublic\u001fotra\u001f1\u001fx\u001fint\u001f1\u001f0\u001f\u001e",
    "K\u001fpublic\u001flineas\u001fpedido_id\u001eK\u001fpublic\u001flineas\u001fn\u001e",
    "F\u001fpublic\u001flineas\u001ffk\u001f1\u001fpedido_id\u001fventas\u001fpedidos\u001fid\u001e",
    "F\u001fpublic\u001flineas\u001ffk\u001f2\u001fn\u001fventas\u001fpedidos\u001fnum\u001e",
  ].join(""),
  "tienda",
  true,
);
eq(multi.truncated, true, "salida cortada");
eq(multi.tables.map((x) => [x.name, x.kind, x.rows]), [["lineas", "table", 10], ["resumen", "view", null]], "tablas y vistas");
eq(multi.tables[0].columns.map((c) => [c.name, c.pk, c.default]), [["pedido_id", true, null], ["n", true, ""]], "clave compuesta; valor por defecto vacío ≠ sin valor");
eq(multi.tables[0].foreignKeys[0].columns, ["pedido_id", "n"], "clave foránea de dos columnas, en orden");
eq(multi.tables[0].foreignKeys[0].refColumns, ["id", "num"], "y sus columnas destino");

// ── DDL ──
eq(parseDdl("mysql", "pedidos\tCREATE TABLE `pedidos` (\n  `id` int(11) NOT NULL\n) ENGINE=InnoDB\n"), "CREATE TABLE `pedidos` (\n  `id` int(11) NOT NULL\n) ENGINE=InnoDB;", "SHOW CREATE TABLE");
eq(
  parseDdl("mysql", "resumen\tCREATE ALGORITHM=UNDEFINED VIEW `resumen` AS select 1\tutf8mb4\tutf8mb4_general_ci\n"),
  "CREATE ALGORITHM=UNDEFINED VIEW `resumen` AS select 1;",
  "SHOW CREATE TABLE de una vista: sin las columnas de juego de caracteres",
);
eq(parseDdl("sqlite", "CREATE TABLE b(id INTEGER);\u001eCREATE INDEX b_a ON b(a_id);\u001e"), "CREATE TABLE b(id INTEGER);\n\nCREATE INDEX b_a ON b(a_id);", "sqlite_master");
eq(
  parseDdl("postgres", "--\n-- PostgreSQL database dump\n--\n\\restrict abc\nSET statement_timeout = 0;\nSELECT pg_catalog.set_config('search_path', '', false);\n\n\n\nCREATE TABLE public.a (\n    id integer\n);\n\n\n\\unrestrict abc\n"),
  "CREATE TABLE public.a (\n    id integer\n);",
  "pg_dump sin comentarios ni SET",
);

// ── Errores ──
eq(classifyError(2, 'psql: error: connection to server at "127.0.0.1", port 5432 failed: FATAL:  password authentication failed for user "postgres"'), "auth", "pg: contraseña");
eq(classifyError(2, 'FATAL:  Peer authentication failed for user "postgres"'), "auth", "pg: peer");
eq(classifyError(2, 'FATAL:  role "leo" does not exist'), "auth", "pg: sin rol");
eq(classifyError(1, "ERROR 1045 (28000): Access denied for user 'root'@'localhost' (using password: NO)"), "auth", "mysql: acceso denegado");
eq(classifyError(2, "FATAL:  la autentificación password falló para el usuario «app»"), "auth", "pg en español");
eq(classifyError(2, 'FATAL:  database "nada" does not exist'), "no-database", "base que no existe");
eq(classifyError(2, 'connection to server on socket "/run/postgresql/.s.PGSQL.5432" failed: No such file or directory'), "unreachable", "sin socket");
eq(classifyError(127, "sshorus: falta el programa psql en el servidor"), "no-client", "sin cliente");
eq(classifyError(127, ""), "no-client", "código 127");
eq(classifyError(2, "sshorus: no existe el archivo"), "no-file", "SQLite que no existe");
eq(classifyError(1, "Error: unable to open database file"), "permission", "SQLite sin permiso");
eq(classifyError(1, "algo raro"), "other", "otro");
eq(errorText("auth", "sshorus: x\nFATAL: password authentication failed"), "La base de datos no aceptó el usuario o la contraseña.\n\nFATAL: password authentication failed", "mensaje con el detalle, sin las líneas propias");

// ── Citas ──
eq(sqlString("o'brien"), "'o''brien'", "literal pg/sqlite");
eq(mysqlString("a\\'b"), "'a\\\\''b'", "literal mysql: barra y comilla");
eq(sqlIdent('ra"ro'), '"ra""ro"', "identificador pg");
eq(mysqlIdent("ra`ro"), "`ra``ro`", "identificador mysql");
eq(pgConnValue("a b'c\\d"), "'a b\\'c\\\\d'", "valor de cadena de conexión");
eq(pgDumpPattern("ventas", 'Pe"didos'), '"ventas"."Pe""didos"', "patrón exacto de pg_dump");
throws(() => sqlString("a\nb"), "sin saltos de línea (el SQL va en un heredoc)");
throws(() => mysqlString(""), "nombre vacío");

// ── Consultas ──
const my = schemaSql("mysql", "tie'nda", { table: "x" });
eq(my.includes("TABLE_SCHEMA = 'tie''nda'") && my.includes("TABLE_NAME = 'x'"), true, "mysql: base y tabla citadas");
eq(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT)\b/i.test(schemaSql("postgres", "x") + schemaSql("mysql", "x") + schemaSql("sqlite", "main")), false, "solo consultas de lectura");
eq(schemaSql("postgres", "x", { schema: "ventas" }).includes("n.nspname = 'ventas'"), true, "pg: filtro de esquema");
eq(ddlSql("mysql", "db", "t"), "SHOW CREATE TABLE `db`.`t`;", "DDL de mysql");
eq(ddlSql("sqlite", "main", "t'x").includes("tbl_name = 't''x'"), true, "DDL de sqlite");

console.log(`${passed} comprobaciones`);
