// Scripts que ejecutan psql, mysql/mariadb, pg_dump o sqlite3 en el servidor (o dentro de un contenedor).
// Funciones puras.
//
// Reglas:
// - La contraseña nunca va en el script ni en la línea de comandos: llega por stdin (la primera línea tras
//   el script, ver privileges/elevate.ts) y pasa al cliente por su variable (PGPASSWORD, MYSQL_PWD); en un
//   contenedor, con `exec -e VARIABLE` (sin valor: se toma del entorno).
// - El SQL va en un heredoc con el delimitador entre comillas (el shell no lo toca).
// - Solo lectura: PostgreSQL con `default_transaction_read_only` y MySQL en `START TRANSACTION READ ONLY`,
//   con límite de tiempo por consulta (30 s) y `timeout` para todo el cliente.
import { shQuote } from "../../lib/remote";
import { pgConnValue, validName } from "./records";
import type { DbAuth, DbEngine, DbPlace } from "./types";

/** Delimitador del heredoc del SQL (los nombres no pueden tener saltos de línea: nunca hay una línea igual). */
const SQL_EOF = "__SSHORUS_SQL__";
/** Límite de cada consulta (s) y de todo el cliente. */
export const STATEMENT_SECS = 30;
export const CLIENT_SECS = 120;
/** Base a la que se conecta para listar las demás en PostgreSQL (siempre existe). */
export const PG_DEFAULT_DB = "postgres";
/** Código de salida cuando falta el programa (como «command not found»). */
export const EXIT_NO_CLIENT = 127;

export type ClientAction = { kind: "sql"; sql: string } | { kind: "pgdump"; pattern: string };

export interface ClientCall {
  engine: DbEngine;
  place: DbPlace;
  auth: DbAuth;
  /** PostgreSQL: base a la que conectar (null = la de por defecto). MySQL y SQLite no la usan. */
  database: string | null;
  action: ClientAction;
}

export interface ClientScript {
  /** Script (sin secretos) para `runScript`. */
  script: string;
  /** Lo que va por stdin al script: la contraseña y un salto de línea, o nada. ¡Es secreto! */
  secret: string;
}

function noClient(name: string): string {
  return `{ echo 'sshorus: falta el programa ${name} en el servidor' >&2; exit ${EXIT_NO_CLIENT}; }`;
}

const inContainer = (p: DbPlace) => p.kind === "container";

// ───────── Cliente (lo que corre donde está la base) ─────────

/** Argumentos de conexión de psql/pg_dump (ya citados; las variables de la imagen, sin citar). */
function pgConn(c: ClientCall): string[] {
  const db = ["-d", shQuote(`dbname=${pgConnValue(c.database ?? PG_DEFAULT_DB)}`)];
  const port = c.place.kind === "host" ? ["-p", String(c.place.port)] : [];
  switch (c.auth.kind) {
    case "password":
      return [
        ...(c.place.kind === "host" ? ["-h", shQuote(c.place.host), ...port] : []),
        "-U",
        shQuote(c.auth.user),
        ...db,
      ];
    case "local":
      return ['-U "${POSTGRES_USER:-postgres}"', ...db];
    default:
      return [...port, ...db];
  }
}

function pgClient(c: ClientCall): string {
  const lines = [
    // standard_conforming_strings: con él apagado (en una base vieja o con ALTER DATABASE), psql tomaría «\'»
    // como comilla escapada y un filtro de la IA podría cerrar el literal y colar `\!` (comando del shell).
    `PGOPTIONS='-c statement_timeout=${STATEMENT_SECS * 1000} -c default_transaction_read_only=on -c standard_conforming_strings=on'; export PGOPTIONS`,
    "PGCONNECT_TIMEOUT=10; export PGCONNECT_TIMEOUT",
    // Mensajes en inglés (se reconocen los errores) y salida en UTF-8.
    "LC_MESSAGES=C; PGCLIENTENCODING=UTF8; export LC_MESSAGES PGCLIENTENCODING",
    "cd / 2>/dev/null",
  ];
  // La propia imagen sabe la contraseña de su usuario: se usa dentro del contenedor y no sale de él.
  if (c.auth.kind === "local") lines.push('[ -z "$PGPASSWORD" ] && [ -n "$POSTGRES_PASSWORD" ] && { PGPASSWORD=$POSTGRES_PASSWORD; export PGPASSWORD; }');
  const conn = pgConn(c).join(" ");
  if (c.action.kind === "pgdump") {
    lines.push(`command -v pg_dump >/dev/null 2>&1 || ${noClient("pg_dump")}`);
    lines.push(`exec pg_dump --schema-only --no-owner --no-privileges -t ${shQuote(c.action.pattern)} ${conn}`);
  } else {
    lines.push(`command -v psql >/dev/null 2>&1 || ${noClient("psql")}`);
    lines.push(`exec psql -X -q -At -F "$(printf '\\037')" -R "$(printf '\\036')" -v ON_ERROR_STOP=1 ${conn}`);
  }
  return lines.join("\n");
}

function myConn(c: ClientCall): string[] {
  switch (c.auth.kind) {
    case "password":
      return [...(c.place.kind === "host" ? ["-h", shQuote(c.place.host), "-P", String(c.place.port)] : []), "-u", shQuote(c.auth.user)];
    case "local":
      return ["-uroot"];
    default:
      return [];
  }
}

function myClient(c: ClientCall): string {
  const lines = ["M=$(command -v mariadb || command -v mysql) || " + noClient("mysql")];
  if (c.auth.kind === "local") {
    // Contraseña de root de la imagen (variable o archivo `_FILE`); se usa dentro del contenedor.
    lines.push(
      'P="${MARIADB_ROOT_PASSWORD:-${MYSQL_ROOT_PASSWORD:-}}"; F="${MARIADB_ROOT_PASSWORD_FILE:-${MYSQL_ROOT_PASSWORD_FILE:-}}"',
      '[ -z "$P" ] && [ -n "$F" ] && [ -r "$F" ] && P=$(cat "$F")',
      '[ -n "$P" ] && [ -z "$MYSQL_PWD" ] && { MYSQL_PWD=$P; export MYSQL_PWD; }',
    );
  }
  lines.push(
    `my() { "$M" --batch --raw -N --connect-timeout=10 ${myConn(c).join(" ")} "$@"; }`,
    "V=$(my -e 'SELECT VERSION()') || exit $?",
    `case $V in *MariaDB*) L='SET SESSION max_statement_time=${STATEMENT_SECS};' ;; *) L='SET SESSION max_execution_time=${STATEMENT_SECS * 1000};' ;; esac`,
    `{ printf '%s\\nSTART TRANSACTION READ ONLY;\\n' "$L"; cat; } | my`,
  );
  return lines.join("\n");
}

function liteClient(path: string): string {
  return [
    `command -v sqlite3 >/dev/null 2>&1 || ${noClient("sqlite3")}`,
    `[ -f ${shQuote(path)} ] || { echo 'sshorus: no existe el archivo' >&2; exit 2; }`,
    `exec sqlite3 -readonly -bail -ascii ${shQuote(path)}`,
  ].join("\n");
}

function clientFor(c: ClientCall): string {
  if (c.engine === "postgres") return pgClient(c);
  if (c.engine === "mysql") return myClient(c);
  if (c.place.kind !== "file") throw new Error("SQLite solo se lee de un archivo");
  return liteClient(c.place.path);
}

// ───────── Envoltorio (dónde y como quién corre el cliente) ─────────

/** Variable de la contraseña de cada motor. */
const PASSWORD_VAR: Record<DbEngine, string | null> = { postgres: "PGPASSWORD", mysql: "MYSQL_PWD", sqlite: null };

/** Corre «$@» como el usuario `postgres` (con root; si no, tal cual). */
const AS_PG = [
  "as_pg() {",
  '  if [ "$(id -u)" != 0 ]; then "$@"',
  '  elif command -v runuser >/dev/null 2>&1; then runuser -u postgres -- "$@"',
  '  elif command -v sudo >/dev/null 2>&1; then sudo -n -u postgres -- "$@"',
  // su (también el de busybox): los argumentos tras -c llegan al shell como $0 $1…
  "  else su -s /bin/sh postgres -c 'exec \"$0\" \"$@\"' \"$@\"; fi",
  "}",
].join("\n");

function validate(c: ClientCall): void {
  if (c.database !== null && !validName(c.database)) throw new Error("Nombre de base no válido");
  if (c.auth.kind === "password" && (!validName(c.auth.user) || /[\n\r\0]/.test(c.auth.password))) {
    throw new Error("Usuario o contraseña no válidos (sin saltos de línea)");
  }
  if (c.place.kind === "container" && !/^[0-9a-f]{12,64}$/.test(c.place.id)) throw new Error("Contenedor no válido");
  if (c.place.kind === "host" && !(Number.isInteger(c.place.port) && c.place.port > 0 && c.place.port < 65536)) throw new Error("Puerto no válido");
  if (c.place.kind === "file" && (!c.place.path.startsWith("/") || /[\n\r\0]/.test(c.place.path))) throw new Error("Usa la ruta completa del archivo (empieza por /)");
}

/** Script completo para `runScript` (y su secreto para stdin). */
export function clientScript(c: ClientCall): ClientScript {
  validate(c);
  const inner = shQuote(clientFor(c));
  const pwVar = c.auth.kind === "password" ? PASSWORD_VAR[c.engine] : null;
  const lines = ["IFS= read -r TV_DBPW || TV_DBPW=''", "TO=''; command -v timeout >/dev/null 2>&1 && TO='timeout " + CLIENT_SECS + "'"];
  if (pwVar) lines.push(`${pwVar}=$TV_DBPW; export ${pwVar}`);
  lines.push("unset TV_DBPW");
  let run: string;
  if (c.place.kind === "container") {
    run = `$TO ${c.place.engine} exec -i ${pwVar ? `-e ${pwVar} ` : ""}${c.place.id} sh -c ${inner}`;
  } else {
    const asService = c.auth.kind === "service" && c.engine === "postgres";
    if (asService) lines.push(AS_PG);
    // `timeout` no puede ejecutar una función del shell: va dentro de as_pg.
    run = `${asService ? "as_pg " : ""}$TO sh -c ${inner}`;
  }
  if (c.action.kind === "sql") lines.push(`${run} <<'${SQL_EOF}'`, c.action.sql, SQL_EOF);
  else lines.push(`${run} </dev/null`);
  return { script: lines.join("\n"), secret: c.auth.kind === "password" ? `${c.auth.password}\n` : "" };
}

/** Se puede leer con esta forma de entrar en ese sitio. */
export function authFits(engine: DbEngine, place: DbPlace, auth: DbAuth["kind"]): boolean {
  if (auth === "local") return inContainer(place) && engine !== "sqlite";
  if (inContainer(place)) return auth === "password";
  if (engine === "sqlite") return auth === "peer" || auth === "service";
  return true;
}
