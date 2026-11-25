// Pruebas de «Ya existe un contenedor con ese nombre»: lectura del error (Podman y Docker), nombres fijos
// del compose, qué contenedores se quitan y el aviso de datos que se pueden perder.
import { assessReplace, conflictTargets, dataDirs, imageBase, parseContainerNames, parseNameConflicts, type Mount } from "./nameConflict";
import { translateError } from "./run";
import type { Container } from "./types";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

// ── parseNameConflicts ──
const podmanOut = [
  " Container seguimiento-siu-db Creating",
  ' service:db:1 Error response from daemon: container create: creating container storage: the container name "seguimiento-siu-db" is already in use by 9f3918727c2d0123456789abcdef0123456789abcdef0123456789abcdef0123. You have to remove that container to be able to reuse that name: that name is already in use',
  "Error: executing /usr/local/lib/docker/cli-plugins/docker-compose -f compose.yaml up -d: exit status 1",
].join("\n");
eq(
  parseNameConflicts(podmanOut),
  [{ name: "seguimiento-siu-db", id: "9f3918727c2d0123456789abcdef0123456789abcdef0123456789abcdef0123" }],
  "Podman (vía docker-compose)",
);
const dockerOut =
  'Error response from daemon: Conflict. The container name "/web" is already in use by container "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef". You have to remove (or rename) that container to be able to reuse that name.';
eq(parseNameConflicts(dockerOut), [{ name: "web", id: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }], "Docker");
eq(parseNameConflicts('Error: name "api" is in use: container already exists'), [{ name: "api", id: null }], "podman create --name");
eq(parseNameConflicts(`${dockerOut}\n${dockerOut}`).length, 1, "sin repetir");
eq(parseNameConflicts("Error: no such image"), [], "otro error");
eq(translateError(podmanOut).split("\n")[0], "Ya existe un contenedor con ese nombre", "el error traducido sigue igual");

// ── parseContainerNames ──
const config = `name: seguimiento_siu
services:
  api:
    container_name: seguimiento-siu-api
    image: seguimiento_siu-api
  db:
    container_name: "seguimiento-siu-db"
    image: docker.io/library/postgres:18
  web:
    image: seguimiento_siu-web
`;
eq(parseContainerNames(config), ["seguimiento-siu-api", "seguimiento-siu-db"], "container_name del compose");

// ── conflictTargets ──
function ct(id: string, name: string, labels: Record<string, string>, owner?: string): Container {
  return { id, name, labels, owner } as unknown as Container;
}
const old = { "io.podman.compose.project": "seguimiento_siu", "com.docker.compose.project": "seguimiento_siu" };
const list = [
  ct("9f3918727c2d00", "seguimiento-siu-db", old, "u:ana"),
  ct("aaaaaaaaaaaa00", "seguimiento-siu-api", old, "u:ana"),
  ct("bbbbbbbbbbbb00", "otro", old, "u:ana"),
  ct("cccccccccccc00", "seguimiento-siu-api", old, "u:luis"),
  ct("dddddddddddd00", "seguimiento-siu-web", { "com.docker.compose.project": "otro" }, "u:ana"),
];
const t = conflictTargets([{ name: "seguimiento-siu-db", id: "9f3918727c2d" }], list, "u:ana", ["seguimiento-siu-api", "seguimiento-siu-db", "seguimiento-siu-web"]);
eq(t.now.map((c) => c.id), ["9f3918727c2d00"], "el que choca (por id), del mismo dueño");
eq(t.later.map((c) => c.id), ["aaaaaaaaaaaa00"], "el que chocará después: nombre fijo y mismo origen; no el de otro usuario ni el de otro proyecto");

// ── assessReplace ──
const vol = (type: string, name: string, destination: string): Mount => ({ type, name, destination, source: "", rw: true });
const anonName = "f".repeat(64);
eq(imageBase("docker.io/library/postgres:18"), "postgres", "nombre corto de la imagen");
eq(imageBase("ghcr.io/x/mariadb@sha256:abc"), "mariadb", "con digest");
eq(dataDirs({ image: "postgres:18", env: [{ key: "PGDATA", value: "/var/lib/postgresql/18/docker" }] }), ["/var/lib/postgresql/18/docker"], "PGDATA manda");
eq(dataDirs({ image: "nginx:alpine", env: [] }), [], "imagen sin datos conocidos");

// Postgres 18 con el volumen en la ruta de siempre: los datos (PGDATA) quedan en un volumen anónimo.
const pg18 = assessReplace({
  image: "docker.io/library/postgres:18",
  env: [{ key: "PGDATA", value: "/var/lib/postgresql/18/docker" }],
  mounts: [vol("volume", "seguimiento_pgdata", "/var/lib/postgresql/data"), vol("volume", anonName, "/var/lib/postgresql")],
  sizeRw: 0,
});
eq([pg18.named.length, pg18.anonymous.length, pg18.unsafeDataDirs, pg18.risky], [1, 1, ["/var/lib/postgresql/18/docker"], true], "postgres 18: riesgo");

const safe = assessReplace({
  image: "postgres:16",
  env: [],
  mounts: [vol("volume", "pgdata", "/var/lib/postgresql/data"), vol("bind", "", "/backups")],
  sizeRw: 4096,
});
eq([safe.named.length, safe.binds.length, safe.anonymous.length, safe.unsafeDataDirs, safe.risky], [1, 1, 0, [], false], "postgres con volumen con nombre: sin riesgo");

const noVolume = assessReplace({ image: "mysql:8.4", env: [], mounts: [], sizeRw: null });
eq([noVolume.unsafeDataDirs, noVolume.risky], [["/var/lib/mysql"], true], "base de datos sin volumen: los datos están dentro del contenedor");

const parentBind = assessReplace({ image: "redis:7", env: [], mounts: [vol("bind", "", "/")], sizeRw: 0 });
eq(parentBind.risky, false, "una carpeta del servidor que contiene la de datos cuenta");

const written = assessReplace({ image: "nginx:alpine", env: [], mounts: [], sizeRw: 50 * 1024 * 1024 });
eq(written.risky, true, "mucho escrito dentro del contenedor");
eq(assessReplace({ image: "nginx:alpine", env: [], mounts: [], sizeRw: 10 }).risky, false, "sin nada que perder");

console.log(`nameConflict: ${passed} comprobaciones OK`);
