// Pruebas de Imágenes: vista previa de «Limpiar sin usar», por qué está desactivado, eliminar una
// selección (en uso o no, con «Todos»), `image inspect` y la selección de filas.
import {
  imageRefs,
  parseImageInspect,
  planImageRemoval,
  pruneBlockedReason,
  pruneImagesCmds,
  prunePreview,
  reclaimed,
  removeImagesCmds,
  usersOf,
} from "./images";
import { parseImages } from "./parse";
import { allSelected, selectionReducer, someSelected } from "./selection";
import { renderCmd } from "./shell";
import type { Container, ImageInfo } from "./types";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

function img(id: string, tags: string[], owner: string, size: number, containers: number | null = null): ImageInfo {
  return { id, shortId: id.slice(0, 12), tags, repository: "", tag: "", size, created: null, containers, dangling: tags.length === 0, owner };
}
function ctr(name: string, image: string, owner: string): Container {
  return {
    id: `${name}-id`,
    shortId: name,
    name,
    image,
    state: "exited",
    status: "",
    exitCode: 0,
    health: null,
    created: null,
    ports: [],
    labels: {},
    networks: [],
    command: "",
    composeProject: null,
    composeService: null,
    composeWorkingDir: null,
    composeConfigFiles: null,
    pod: null,
    owner,
  };
}

const LEO = "u:leo_oti";
const PG = img("aaaaaaaaaaaa1111", ["docker.io/library/postgres:17"], LEO, 400);
const OLD = img("bbbbbbbbbbbb2222", [], LEO, 100);
const NGINX = img("cccccccccccc3333", ["docker.io/library/nginx:alpine", "localhost/web:1"], LEO, 50);
const ROOT_DANGLING = img("dddddddddddd4444", [], "root", 30);
const images = [PG, OLD, NGINX, ROOT_DANGLING];
// La base de datos (parada) usa postgres por nombre corto: también cuenta como «en uso».
const containers = [ctr("seguimiento-siu-db", "postgres:17", LEO)];

// ── Quién la usa ──
eq(usersOf(PG, containers).map((c) => c.name), ["seguimiento-siu-db"], "postgres:17 = docker.io/library/postgres:17");
eq(usersOf(PG, [ctr("x", "postgres:17", "root")]).length, 0, "un contenedor de otro usuario no cuenta");

// ── Vista previa de la limpieza ──
const dang = prunePreview(images, containers, "dangling");
eq([dang.count, dang.bytes], [2, 130], "solo sin nombre: las dos colgantes");
eq(dang.owners.map((g) => [g.owner, g.images.length, g.bytes]), [[LEO, 1, 100], ["root", 1, 30]], "agrupadas por dueño");
const all = prunePreview(images, containers, "all");
eq([all.count, all.bytes], [3, 180], "todas las sin usar: también nginx (postgres está en uso)");
eq(
  pruneImagesCmds("podman", dang, "dangling").map((c) => [c.owner, renderCmd(c)]),
  [
    [LEO, "podman image prune -f 2>&1"],
    ["root", "podman image prune -f 2>&1"],
  ],
  "un prune por dueño con «Todos»",
);
eq(pruneImagesCmds("docker", all, "all").map(renderCmd)[0], "docker image prune -f -a 2>&1", "-a con «todas»");
eq(pruneImagesCmds("podman", prunePreview([PG], containers, "all"), "all").length, 0, "nada que limpiar: sin comandos");

// ── Por qué está desactivado ──
eq(pruneBlockedReason({ loaded: false, error: null, images: [], containers: [] }), "todavía se están leyendo las imágenes", "leyendo");
eq(pruneBlockedReason({ loaded: false, error: "x", images: [], containers: [] })?.startsWith("no se pudieron leer"), true, "error al leer");
eq(pruneBlockedReason({ loaded: true, error: null, images: [], containers: [] }), "no hay imágenes en el servidor", "sin imágenes");
eq(pruneBlockedReason({ loaded: true, error: null, images: [PG], containers })?.startsWith("todas las imágenes las usa"), true, "todas en uso");
eq(pruneBlockedReason({ loaded: true, error: null, images, containers }), null, "con «Todos» ya no se desactiva");
eq(pruneBlockedReason({ loaded: true, error: null, images: [img("e", ["a:1"], LEO, 1, 2)], containers: [] }) !== null, true, "el motor dice que la usan 2");

// ── Eliminar una selección ──
eq(imageRefs(NGINX), ["docker.io/library/nginx:alpine", "localhost/web:1"], "varias etiquetas: se pasan todas (sin -f)");
eq(imageRefs(OLD), ["bbbbbbbbbbbb2222"], "sin nombre: el id");
// Docker, una línea por etiqueta: la bajada solo por su digest («<none>») no se llama «nginx:latest».
const docker = parseImages(
  [
    { ID: "sha256:" + "1".repeat(64), Repository: "nginx", Tag: "latest", Size: "190MB" },
    { ID: "sha256:" + "2".repeat(64), Repository: "nginx", Tag: "<none>", Size: "180MB" },
  ]
    .map((o) => JSON.stringify(o))
    .join("\n"),
);
eq(docker.map((i) => [i.tags, i.dangling]), [[["nginx:latest"], false], [[], true]], "docker: sin etiqueta no es «:latest» (y prune la cuenta como sin nombre)");
eq(imageRefs(docker[1]), ["2".repeat(64)], "eliminar la de solo digest va por su id, no borra «nginx:latest»");
const plan = planImageRemoval([PG, NGINX, ROOT_DANGLING], containers);
eq([plan.free.map((i) => i.id), plan.inUse.map((u) => [u.img.id, u.count, u.users.map((c) => c.name)])], [[NGINX.id, ROOT_DANGLING.id], [[PG.id, 1, ["seguimiento-siu-db"]]]], "en uso aparte");
eq(
  removeImagesCmds("podman", plan, false, "self").map((c) => [c.owner, renderCmd(c)]),
  [
    [LEO, "podman rmi docker.io/library/nginx:alpine localhost/web:1"],
    ["root", "podman rmi dddddddddddd4444"],
  ],
  "sin forzar: solo las libres, por dueño",
);
eq(removeImagesCmds("podman", plan, true, "self").map(renderCmd)[0], "podman rmi -f docker.io/library/nginx:alpine localhost/web:1 docker.io/library/postgres:17", "forzar: también las que están en uso");
eq(removeImagesCmds("podman", planImageRemoval([PG], containers), false, "self").length, 0, "solo en uso y sin forzar: nada");

// ── image inspect ──
const INSPECT = JSON.stringify([
  {
    Id: "sha256:aaaaaaaaaaaa1111",
    RepoTags: ["docker.io/library/postgres:17"],
    RepoDigests: ["docker.io/library/postgres@sha256:beef"],
    Created: "2025-01-02T03:04:05Z",
    Size: 438000000,
    Os: "linux",
    Architecture: "amd64",
    Config: { User: "", Env: ["PGDATA=/var/lib/postgresql/data"], Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"], WorkingDir: "", ExposedPorts: { "5432/tcp": {} }, Labels: null },
  },
]);
const d = parseImageInspect(INSPECT);
eq([d?.id, d?.os, d?.arch, d?.ports, d?.entrypoint, d?.cmd, d?.env.length, d?.size], ["aaaaaaaaaaaa1111", "linux", "amd64", ["5432/tcp"], ["docker-entrypoint.sh"], ["postgres"], 1, 438000000], "inspect");
eq(parseImageInspect("no es json"), null, "inspect inválido");

// ── Salida de prune ──
eq(reclaimed("Deleted Images:\nuntagged: x\nTotal reclaimed space: 1.2GB"), "Espacio liberado: 1.2GB", "docker");
eq(reclaimed("bbbbbbbbbbbb2222ffff\n"), "1 elementos eliminados", "podman: ids");

// ── Selección ──
let s = selectionReducer(new Set(), { type: "toggle", key: "a" });
eq([...s], ["a"], "marcar una");
s = selectionReducer(s, { type: "toggleAll", keys: ["a", "b", "c"] });
eq([...s].sort(), ["a", "b", "c"], "marcar todas las visibles");
eq(allSelected(s, ["a", "b", "c"]), true, "todas");
s = selectionReducer(s, { type: "toggleAll", keys: ["a", "b", "c"] });
eq(s.size, 0, "si ya estaban todas, se desmarcan");
s = selectionReducer(new Set(["a", "z"]), { type: "toggleAll", keys: ["a", "b"] });
eq([...s].sort(), ["a", "b", "z"], "las de fuera del filtro se quedan");
eq(someSelected(new Set(["a"]), ["a", "b"]), true, "a medias");
const kept = selectionReducer(new Set(["a", "gone"]), { type: "retain", keys: ["a", "b"] });
eq([...kept], ["a"], "olvida las que ya no existen");
const same = new Set(["a"]);
eq(selectionReducer(same, { type: "retain", keys: ["a"] }) === same, true, "sin cambios: el mismo objeto (no re-renderiza)");
eq(selectionReducer(new Set(["a"]), { type: "clear" }).size, 0, "ninguna");

console.log(`imágenes: ${passed} pruebas correctas`);
