// Pruebas de «Comparar archivos»: nombres de los lados, claves de pestaña, selección de dos archivos,
// tamaño y binarios, avisos, ruta por defecto y copias de seguridad.
import {
  backupCandidates,
  blockedMessage,
  compareKey,
  compareTitle,
  defaultOtherPath,
  isCompareKey,
  looksBinary,
  missingMessage,
  originalOf,
  otherSessions,
  pairFromSelection,
  remotePathProblem,
  sameSide,
  sideLabel,
  sizeProblem,
  swapSides,
  type CompareSpec,
} from "./model";
import { basename } from "../../lib/paths";

declare const process: { exit(code: number): never };

let failed = 0;
let passed = 0;
function ok(cond: unknown, msg: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`✗ ${msg}`);
  }
}
function eq<T>(a: T, b: T, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}

const web = { kind: "remote" as const, sessionId: "s1", server: "web", path: "/etc/nginx/nginx.conf" };
const db = { kind: "remote" as const, sessionId: "s2", server: "db", path: "/etc/nginx/nginx.conf" };
const pc = { kind: "local" as const, path: "C:\\Users\\ana\\nginx.conf" };

// Nombres
eq(sideLabel(web), "web:/etc/nginx/nginx.conf", "nombre de un lado remoto");
eq(sideLabel(pc), "Este equipo:C:\\Users\\ana\\nginx.conf", "nombre de un lado local");
eq(compareTitle({ left: pc, right: web }), "nginx.conf (comparar)", "mismo nombre: «(comparar)»");
eq(compareTitle({ left: web, right: { ...web, path: "/etc/hosts" } }), "nginx.conf ↔ hosts", "nombres distintos");
const spec: CompareSpec = { left: db, right: web };
eq(swapSides(spec), { left: web, right: db }, "intercambiar lados");
ok(sameSide(web, { ...web }) && !sameSide(web, db) && !sameSide(web, { kind: "local", path: web.path }), "mismo lado");

// Claves de pestaña
const key = compareKey(3, spec);
ok(isCompareKey(key) && !isCompareKey("/etc/sshorus-compare:1"), "clave reconocible");
eq(basename(key), "nginx.conf", "la clave acaba en el nombre (avisos de cambios sin guardar)");
ok(compareKey(4, spec) !== key, "claves distintas para cada comparación");

// Selección de dos archivos
const f = (path: string, kind: "file" | "dir" | "symlink" = "file", isDirLink = false) => ({ path, kind, isDirLink });
eq(pairFromSelection([f("/a"), f("/b")]), { ok: true, left: "/a", right: "/b" }, "dos archivos");
ok(!pairFromSelection([f("/a")]).ok, "uno solo no");
ok(!pairFromSelection([f("/a"), f("/b"), f("/c")]).ok, "tres no");
ok(!pairFromSelection([f("/a"), f("/d", "dir")]).ok, "una carpeta no");
ok(!pairFromSelection([f("/a"), f("/l", "symlink", true)]).ok, "enlace a carpeta no");
ok(pairFromSelection([f("/a"), f("/l", "symlink")]).ok, "enlace a archivo sí");

// Tamaño y binarios
eq(sizeProblem(5 * 1024 * 1024), null, "5 MB justos se comparan");
ok(sizeProblem(5 * 1024 * 1024 + 1)?.includes("máximo 5 MB"), "más de 5 MB no");
eq(sizeProblem(12 * 1024 * 1024), "Es demasiado grande para compararlo (12 MB; máximo 5 MB).", "mensaje de tamaño");
ok(looksBinary("PNG\0\0data") && !looksBinary("hola\nmundo"), "binario por caracteres nulos");

// Avisos
const okText = { state: "ok" as const, content: "", modified: null };
const missing = { state: "missing" as const };
eq(blockedMessage(okText, okText), null, "sin bloqueo");
eq(blockedMessage({ state: "blocked", reason: "binario" }, okText), "Izquierda: binario", "bloqueo a la izquierda");
eq(missingMessage(okText, okText), null, "los dos existen");
ok(missingMessage(okText, missing)?.includes("se crea"), "falta la derecha: se crea al guardar");
ok(missingMessage(missing, okText)?.includes("izquierda"), "falta la izquierda");
eq(missingMessage(missing, missing), "Ninguno de los dos archivos existe.", "faltan los dos");

// Ruta por defecto y validación
eq(defaultOtherPath("server", "/etc/hosts"), "/etc/hosts", "otro servidor: la misma ruta");
eq(defaultOtherPath("here", "/etc/nginx/nginx.conf"), "/etc/nginx/", "este servidor: su carpeta");
eq(defaultOtherPath("here", "/hosts"), "/", "este servidor, en la raíz");
eq(remotePathProblem("/etc/hosts"), null, "ruta válida");
ok(remotePathProblem("") && remotePathProblem("etc/hosts") && remotePathProblem("/etc/"), "rutas no válidas");

// Otras conexiones
const tabs = [
  { sessionId: "s1", title: "web", status: "connected" },
  { sessionId: "s2", title: "db", status: "connected" },
  { sessionId: "s3", title: "viejo", status: "closed" },
  { sessionId: "s4", title: "web", status: "connected" },
];
eq(otherSessions(tabs, "s1").map((t) => t.sessionId), ["s2", "s4"], "otras conexiones abiertas (también al mismo servidor)");

// Copias de seguridad
const sib = [
  "docker-compose.yml",
  "docker-compose.yml.bak-sshorus-20261101-090000",
  "docker-compose.yml.bak-sshorus-20261124-183005",
  "docker-compose.yml.bak",
  "otro.yml.bak",
];
eq(
  backupCandidates("docker-compose.yml", sib).map((c) => c.name),
  ["docker-compose.yml.bak-sshorus-20261124-183005", "docker-compose.yml.bak-sshorus-20261101-090000", "docker-compose.yml.bak"],
  "copias, la más nueva primero",
);
eq(backupCandidates("docker-compose.yml", sib)[0].label, "Copia del 24/11/2026 18:30", "fecha de la copia");
eq(backupCandidates("sshd_config", ["sshd_config", "sshd_config.sshorus.bak"])[0].label, "Copia «.sshorus.bak»", "copia de sshd");
eq(backupCandidates("nada.txt", sib), [], "sin copias, no se inventa ninguna");
eq(backupCandidates("docker-compose.yml.bak", sib)[0], { name: "docker-compose.yml", label: "Archivo original" }, "desde la copia: el original");
eq(originalOf("sshd_config.sshorus.bak"), "sshd_config", "original de .sshorus.bak");
eq(originalOf("a.bak-sshorus-20260101-000000"), "a", "original de una copia con fecha");
eq(originalOf(".bak"), null, "«.bak» solo no es una copia");
eq(originalOf("hosts"), null, "un archivo normal no es copia");

console.log(`${passed} pruebas bien, ${failed} mal`);
if (failed) process.exit(1);
