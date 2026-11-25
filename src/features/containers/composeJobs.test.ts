// Pruebas de las tareas largas de Compose y del editor del archivo compose: salida en vivo (líneas de
// progreso juntas, logs de Podman, ruido) y leer/guardar el archivo conservando permisos y con copia.
// Los scripts se ejecutan de verdad con `sh` en una carpeta temporal. Lo común de las tareas (salida,
// «Cancelar» que detiene el grupo de procesos) se prueba en features/jobs/jobs.test.ts.
import { JobOutput } from "../jobs/output";
import { COMPOSE_OUTPUT, composeLine, progressKey } from "./composeOutput";
import { composeFilePath, decodeBase64Text, encodeBase64Text, parseReadFile, parseStatFile, parseWriteFile, readFileScript, statFileScript, writeFileScript } from "./composeFile";

const CHILD = "node:child_process";
const cp = (await import(/* @vite-ignore */ CHILD)) as {
  spawnSync: (cmd: string, args: string[], opts: { encoding: "utf8"; env?: Record<string, string | undefined> }) => { status: number | null; stdout: string; stderr: string };
};
const FS = "node:fs";
const fs = (await import(/* @vite-ignore */ FS)) as {
  mkdtempSync: (prefix: string) => string;
  readFileSync: (p: string, enc: "utf8") => string;
  writeFileSync: (p: string, data: string) => void;
  chmodSync: (p: string, mode: number) => void;
  statSync: (p: string) => { mode: number };
  readdirSync: (p: string) => string[];
  rmSync: (p: string, o: { recursive: boolean; force: boolean }) => void;
};
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(cond: boolean, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}

// ── Salida en vivo ──
eq(
  composeLine('time="2026-11-24T23:11:56-05:00" level=warning msg="StopSignal SIGTERM failed to stop container x in 10 seconds, resorting to SIGKILL"'),
  "Aviso: StopSignal SIGTERM failed to stop container x in 10 seconds, resorting to SIGKILL",
  "log de Podman en texto llano",
);
// Salida real de `podman compose up -d` (con docker-compose) cuando el nombre ya existe.
const real = new JobOutput(COMPOSE_OUTPUT);
real.push(
  '\x1b[4m>>>> Executing external compose provider "/usr/libexec/docker/cli-plugins/docker-compose". Please see podman-compose(1) for how to disable this message. <<<<\n\n\x1b[0m Network nc_default Creating \n Network nc_default Creating \n Network nc_default Created \n Network nc_default Created \n Container sshorus-nc-test-app Creating \n',
);
real.push(
  ' service:app:1 Error response from daemon: container create: creating container storage: the container name "sshorus-nc-test-app" is already in use by 40d75a8809de07b3e2be9f7ae4c59bd7881bd6d7d14bdc03bdf803d2bcb26967. You have to remove that container to be able to reuse that name: that name is already in use \nError: executing /usr/libexec/docker/cli-plugins/docker-compose up -d: exit status 1\n',
);
eq(real.view().length, 4, "salida real: una línea por red y por contenedor, sin el aviso de Podman");
eq(real.view()[0], " Network nc_default Created", "salida real: el último estado de la red");
eq(progressKey(" 1a2b3c4d5e6f Downloading [==>   ] 1MB/5MB"), "layer:1a2b3c4d5e6f", "capa de Docker");
eq(progressKey("Copying blob sha256:1a2b3c4d5e6f7a8b done"), "blob:1a2b3c4d5e6f", "capa de Podman");
eq(progressKey(" Container seguimiento-siu-db Creating"), "container:seguimiento-siu-db", "contenedor");
eq(progressKey(" Image docker.io/library/postgres:18 Pulled"), "image:docker.io/library/postgres:18", "imagen");
eq(progressKey(" ✔ db Pulled   12.3s"), "service:db", "formato corto");
eq(progressKey("#5 [2/5] RUN npm ci"), null, "la construcción no se junta");
eq(progressKey("npm Error something went wrong in the build"), null, "un texto cualquiera no se junta");

const out = new JobOutput(COMPOSE_OUTPUT);
out.push(" Image docker.io/library/postgres:18 Pulling\n 1a2b3c4d5e6f Downloading [=>  ] 1MB/9MB\n");
out.push(" 1a2b3c4d5e6f Downloading [==> ] 5MB/9MB\n 1a2b3c4d5e6f Pull complete\n Image docker.io/library/postgres:18 Pulled\n");
out.push("Executing external compose provider \"/usr/local/lib/docker/cli-plugins/docker-compose\". Please see podman-compose(1)\n");
out.push(" Container seguimiento-siu-db Creating\n Container seguimiento-siu-db Error response from daemon: x\nError: exit status 1");
eq(
  out.view(),
  [" Image docker.io/library/postgres:18 Pulled", " 1a2b3c4d5e6f Pull complete", " Container seguimiento-siu-db Error response from daemon: x", "Error: exit status 1"],
  "una línea por capa y por contenedor, sin el aviso de Podman; la línea a medias se ve",
);
out.end();
eq(out.view().length, 4, "al terminar no se repite la última");
// ── Ruta del archivo ──
eq(composeFilePath("/srv/app/", "compose.yaml"), "/srv/app/compose.yaml", "relativa a la carpeta");
eq(composeFilePath("/srv/app", "/etc/x.yml"), "/etc/x.yml", "absoluta");
eq(composeFilePath("/srv/app", ""), null, "sin archivo conocido");
eq(decodeBase64Text(encodeBase64Text("ñandú ✓ 🐘\n")), "ñandú ✓ 🐘\n", "base64 con UTF-8");

const tmp = fs.mkdtempSync("/tmp/sshorus-cj-");
const sh = (script: string) => cp.spawnSync("sh", ["-c", script], { encoding: "utf8", env: { ...env, TMPDIR: tmp } });
try {
  // ── Leer y guardar el compose ──
  const f = `${tmp}/compose.yaml`;
  fs.writeFileSync(f, "services:\n  db:\n    image: postgres:17\n");
  fs.chmodSync(f, 0o640);
  const r = parseReadFile(sh(readFileScript(f)).stdout);
  ok(r.kind === "ok" && r.content.includes("postgres:17") && r.meta.mode === "640", "leer: contenido y permisos");
  eq(parseReadFile(sh(readFileScript(`${tmp}/no.yaml`)).stdout).kind, "missing", "leer: no existe");

  const nuevo = "services:\n  db:\n    image: postgres:18 # ñ\n";
  const w = sh(writeFileScript(f, nuevo, true));
  eq(w.status, 0, `guardar: sale bien (${w.stderr})`);
  const saved = parseWriteFile(w.stdout);
  eq(fs.readFileSync(f, "utf8"), nuevo, "guardar: contenido nuevo");
  eq((fs.statSync(f).mode & 0o777).toString(8), "640", "guardar: conserva los permisos");
  ok(!!saved.backup && /\.bak-sshorus-\d{8}-\d{6}$/.test(saved.backup), "guardar: copia con fecha");
  eq(fs.readFileSync(saved.backup ?? "", "utf8"), "services:\n  db:\n    image: postgres:17\n", "guardar: la copia tiene lo de antes");
  eq(parseWriteFile(sh(writeFileScript(f, "", false)).stdout).backup, null, "sin copia la segunda vez");
  eq(fs.readFileSync(f, "utf8"), "", "guardar vacío");
  eq(parseStatFile(sh(statFileScript(f)).stdout)?.size, 0, "datos del archivo");
  eq(parseStatFile(sh(statFileScript(`${tmp}/no.yaml`)).stdout), null, "datos: no existe");
  ok(fs.readdirSync(tmp).every((n) => !n.startsWith("sshorus-edit.")), "no quedan temporales");

} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`composeJobs: ${passed} comprobaciones OK`);
