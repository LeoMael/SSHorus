// Pruebas de «Podman usa las carpetas de root»: mensajes (nunca del grupo docker con Podman), qué
// runroot se elige y el script de arreglo, ejecutado de verdad con `sh` en un HOME temporal
// (y la lectura de la base de datos con python3 + sqlite3, si están).
// Ejecutar: npx rolldown src/features/containers/rootStorage.test.ts -p node -f esm -o /tmp/rs.mjs && node /tmp/rs.mjs
import { engineProblem, parseDetect } from "./detect";
import { translateError } from "./run";
import {
  STORAGE_PROBE_SCRIPT,
  decideRunroot,
  existingConfAdvice,
  parseStorageProbe,
  rootStorageOwners,
  storageFix,
  usablePath,
  usesRootStorage,
  type StorageProbe,
} from "./rootStorage";
import { renderCmd } from "./shell";
import type { CtOwner, OwnerUser } from "./owner";

const CHILD = "node:child_process";
const { spawnSync } = (await import(/* @vite-ignore */ CHILD)) as {
  spawnSync: (
    cmd: string,
    args: string[],
    opts: { encoding: "utf8"; env?: Record<string, string | undefined> },
  ) => { status: number | null; stdout: string; stderr: string };
};
const FS = "node:fs";
const fs = (await import(/* @vite-ignore */ FS)) as {
  mkdtempSync: (prefix: string) => string;
  readFileSync: (p: string, enc: "utf8") => string;
  writeFileSync: (p: string, data: string) => void;
  existsSync: (p: string) => boolean;
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

const RAW =
  'time="2026-11-18T10:00:00-05:00" level=warning msg="RunRoot is pointing to a path (/run/containers/storage) which is not writable. Most likely podman will fail.: permission denied"\n' +
  'Error: cannot evaluate symlinks on DB run root path "/run/containers/storage": lstat /run/containers/storage: permission denied';

// ───────── Mensajes ─────────
{
  ok(usesRootStorage(RAW), "error completo");
  ok(usesRootStorage(RAW.replace(/\n/g, " ").slice(0, 300)), "cortado y en una línea (detección)");
  ok(usesRootStorage('Error: mkdir /var/lib/containers/storage/overlay: permission denied'), "graphroot de root");
  ok(!usesRootStorage("Error: no such container web"), "otro error");
  ok(!usesRootStorage(null), "sin error");

  const pr = engineProblem("podman", RAW);
  ok(pr.problem.startsWith("Podman de este usuario usa las carpetas de root"), pr.problem);
  eq(pr.needsSudo, false, "Podman: no hace falta sudo");
  const pd = engineProblem("podman", "Error: open /home/a/.local/share/containers/storage/x: permission denied");
  ok(!pd.problem.includes("docker") && !pd.needsSudo, `Podman, otro permiso: ${pd.problem}`);
  const dk = engineProblem("docker", "permission denied while trying to connect to the Docker daemon socket");
  ok(dk.problem.includes("grupo «docker»") && dk.needsSudo, "Docker sigue igual");

  const det = parseDetect(
    ["tv_begin=1", "uid=1000", "podman=1", "podman_ok=0", `podman_err=${RAW.replace(/\n/g, " ").slice(0, 300)}`, "tv_end=1"].join("\n"),
  );
  ok(!(det.podman?.problem ?? "").includes("docker"), det.podman?.problem ?? "");

  const pull = translateError("Error: writing blob: docker.io/library/nginx: open /x: permission denied");
  ok(!pull.includes("Docker"), `un error de Podman que nombra docker.io no es «Sin permiso para usar Docker»: ${pull}`);
  ok(translateError(RAW).startsWith("Podman de este usuario usa las carpetas de root"), "regla de runroot de root");
}

// ───────── Qué runroot ─────────
{
  eq(decideRunroot({ uid: 1001, dbRunRoot: "/run/user/1001/containers" }), { path: "/run/user/1001/containers", source: "db" }, "el de la base de datos");
  eq(decideRunroot({ uid: 1001, dbRunRoot: "/tmp/storage-run-1001/containers" }), { path: "/tmp/storage-run-1001/containers", source: "db" }, "aunque no sea /run/user");
  eq(decideRunroot({ uid: 1001, dbRunRoot: "/run/containers/storage" }), { path: "/run/user/1001/containers", source: "default" }, "el de root no sirve");
  eq(decideRunroot({ uid: 1001, dbRunRoot: null }), { path: "/run/user/1001/containers", source: "default" }, "sin base de datos");
  eq(decideRunroot({ uid: 1001, dbRunRoot: 'x"y' }), { path: "/run/user/1001/containers", source: "default" }, "ruta rara");
  eq(decideRunroot({ uid: null, dbRunRoot: null }), null, "sin uid no se inventa");
  ok(!usablePath("/var/lib/containers/storage") && !usablePath("rel/path") && !usablePath("/a\nb") && usablePath("/home/a b/x"), "usablePath");
}

// ───────── Quién lo tiene ─────────
{
  const u = (name: string): CtOwner => ({ kind: "user", user: { name, uid: 1001, home: `/home/${name}`, podman: true, docker: false, runtimeDir: true } as OwnerUser });
  const owners = [u("ana"), u("leo")];
  const base = { engine: "podman" as const, isRoot: false, selfError: null, owners, errors: { "u:leo": RAW, "u:ana": "Error: no such image" } };
  eq(rootStorageOwners(base).map((o) => (o.kind === "user" ? o.user.name : o.kind)), ["leo"], "solo el usuario con ese error");
  eq(rootStorageOwners({ ...base, selfError: RAW }).map((o) => o.kind), ["self", "user"], "tú, por la detección");
  eq(rootStorageOwners({ ...base, engine: "docker" }), [], "Docker: no aplica");
  eq(rootStorageOwners({ ...base, isRoot: true, selfError: RAW }).map((o) => o.kind), ["user"], "root usa las de root a propósito");
}

// ───────── Script de arreglo, de verdad ─────────
const probe = (p: Partial<StorageProbe>): StorageProbe => ({
  ok: true,
  uid: 1001,
  home: "/home/ana",
  confExists: false,
  confLines: [],
  db: false,
  python: false,
  dbGraphRoot: null,
  dbRunRoot: null,
  ...p,
});
{
  eq(storageFix(probe({ confExists: true })), null, "nunca si ya existe");
  eq(storageFix(probe({ ok: false })), null, "comprobación incompleta");
  eq(storageFix(probe({ home: null })), null, "sin HOME");
  const fx = storageFix(probe({ dbRunRoot: "/run/user/1001/containers" }));
  ok(!!fx, "hay arreglo");
  eq(
    fx?.text,
    '[storage]\ndriver = "overlay"\ngraphroot = "/home/ana/.local/share/containers/storage"\nrunroot = "/run/user/1001/containers"',
    "storage.conf",
  );
  eq(fx?.runrootSource, "db", "origen");
  ok(renderCmd(fx!.cmd).startsWith("sh -c "), "un solo comando sh -c (para ejecutarlo como el dueño)");
  ok(existingConfAdvice(probe({ confExists: true, confLines: ['runroot = "/run/containers/storage"'] })).includes('runroot = "/run/user/1001/containers"'), "qué revisar");

  const tmp = fs.mkdtempSync("/tmp/sshorus-rs-");
  try {
    const home = `${tmp}/home de ana`;
    const fix = storageFix(probe({ home, uid: 1001, dbRunRoot: "/run/user/1001/containers" }))!;
    const run = () => spawnSync("sh", ["-c", renderCmd(fix.cmd)], { encoding: "utf8", env: { ...env, HOME: home } });
    const r1 = run();
    eq(r1.status, 0, `crea el archivo: ${r1.stderr}`);
    eq(fs.readFileSync(fix.file, "utf8"), `${fix.text}\n`, "contenido exacto");
    fs.writeFileSync(fix.file, "# mío\n");
    const r2 = run();
    ok(r2.status !== 0 && r2.stderr.includes("no se ha tocado"), "si existe, falla");
    eq(fs.readFileSync(fix.file, "utf8"), "# mío\n", "y no lo pisa");

    // La comprobación, con su base de datos (python3 + sqlite3, si están).
    const py = spawnSync("python3", ["-c", "import sqlite3"], { encoding: "utf8" });
    const home2 = `${tmp}/leo`;
    if (py.status === 0) {
      const db = `${home2}/.local/share/containers/storage/db.sql`;
      spawnSync(
        "python3",
        [
          "-c",
          'import os,sqlite3,sys; os.makedirs(os.path.dirname(sys.argv[1])); c=sqlite3.connect(sys.argv[1]); c.execute("CREATE TABLE DBConfig (ID INTEGER, StaticDir TEXT, TmpDir TEXT, GraphRoot TEXT, RunRoot TEXT, VolumeDir TEXT)"); c.execute("INSERT INTO DBConfig VALUES (1, ?, ?, ?, ?, ?)", ("s", "t", "/home/leo/.local/share/containers/storage", "/run/user/1002/containers", "v")); c.commit()',
          db,
        ],
        { encoding: "utf8" },
      );
    }
    const pr = spawnSync("sh", ["-c", STORAGE_PROBE_SCRIPT], { encoding: "utf8", env: { ...env, HOME: home2 } });
    const p = parseStorageProbe(pr.stdout);
    ok(p.ok && p.home === home2 && !p.confExists, `comprobación: ${pr.stdout}${pr.stderr}`);
    if (py.status === 0) {
      eq([p.db, p.python, p.dbRunRoot, p.dbGraphRoot], [true, true, "/run/user/1002/containers", "/home/leo/.local/share/containers/storage"], "lee DBConfig");
      eq(decideRunroot(p)?.source, "db", "usa el de la base de datos");
    }
    const pe = spawnSync("sh", ["-c", STORAGE_PROBE_SCRIPT], { encoding: "utf8", env: { ...env, HOME: home } });
    const pp = parseStorageProbe(pe.stdout);
    ok(pp.confExists && pp.confLines.length === 0, "ve el storage.conf que ya existe");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`rootStorage: ${passed} comprobaciones OK`);
