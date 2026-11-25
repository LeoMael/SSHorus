// «Bases de datos»: tipos de los destinos (dónde está cada base y cómo se entra) y del esquema leído.
import type { CtOwner } from "../containers/owner";
import type { Engine } from "../containers/types";

export type DbEngine = "postgres" | "mysql" | "sqlite";

/** Dónde vive la base: un servicio del servidor, un contenedor o un archivo SQLite. */
export type DbPlace =
  | { kind: "host"; host: string; port: number }
  | {
      kind: "container";
      engine: Engine;
      /** Dueño del contenedor (tú, root u otro usuario). */
      owner: CtOwner;
      /** Usuario real del contenedor, para mostrarlo. */
      user: string;
      /** Para entrar hace falta la elevación (sudo) con la que se leyó la lista. */
      sudo: boolean;
      id: string;
      name: string;
      image: string;
    }
  | { kind: "file"; path: string };

export interface DbTarget {
  /** Clave estable (también la de la credencial guardada): `pg@127.0.0.1:5432`, `mysql@ctr:ana/tienda-db`… */
  key: string;
  engine: DbEngine;
  place: DbPlace;
  /** Nombre corto para la lista. */
  label: string;
  /** Detalle (puerto, imagen, programa…). */
  detail: string;
  /** Aviso si no se podrá leer (falta el programa cliente en el servidor…). */
  problem: string | null;
}

/**
 * Cómo se entra:
 * - peer: como el usuario conectado, sin contraseña (socket local, `~/.my.cnf`…).
 * - service: como el usuario de la base en el servidor (`postgres`) o root, con sudo.
 * - local: dentro del contenedor, por su socket y con las variables de la propia imagen.
 * - password: usuario y contraseña (la contraseña va por stdin y entra al cliente por su variable).
 */
export type DbAuth = { kind: "peer" } | { kind: "service" } | { kind: "local" } | { kind: "password"; user: string; password: string };

export type DbAuthKind = DbAuth["kind"];

export interface DbDatabase {
  name: string;
  /** Bytes (null = no se pudo leer, p. ej. sin permiso). */
  bytes: number | null;
}

export type DbTableKind = "table" | "view" | "matview" | "foreign" | "partitioned";

export interface DbColumn {
  name: string;
  type: string;
  nullable: boolean;
  /** Expresión por defecto (null = sin valor por defecto). */
  default: string | null;
  pk: boolean;
}

export interface DbIndex {
  name: string;
  unique: boolean;
  primary: boolean;
  /** Definición corta: «btree (id)», «(email)». */
  columns: string;
}

export interface DbForeignKey {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
}

export interface DbTable {
  schema: string;
  name: string;
  kind: DbTableKind;
  /** Filas aproximadas (estadísticas del motor; null = sin dato). */
  rows: number | null;
  bytes: number | null;
  comment: string;
  columns: DbColumn[];
  indexes: DbIndex[];
  foreignKeys: DbForeignKey[];
}

export interface DbSchema {
  database: string;
  version: string | null;
  tables: DbTable[];
  /** La salida se cortó (esquema enorme): falta parte. */
  truncated: boolean;
}

export interface DbList {
  version: string | null;
  databases: DbDatabase[];
}
