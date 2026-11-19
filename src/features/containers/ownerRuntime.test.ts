// Pruebas de Podman de otros usuarios sin sesión: carpeta de ejecución propia (la línea de la terminal,
// ejecutada de verdad con `sh`), aviso de linger y errores legibles por usuario.
// Ejecutar: npx rolldown src/features/containers/ownerRuntime.test.ts -p node -f esm -o /tmp/ort.mjs && node /tmp/ort.mjs
import { listContainers } from "./commands";
import { enableLingerCmd, mergeOwned, ownerLine, runtimeFallback, usersWithoutLinger, type CtOwner, type LineCtx, type OwnerUser } from "./owner";
import { cleanEngineLog, translateError } from "./run";
import { renderCmd, type Cmd } from "./shell";

// Sin @types/node en el proyecto: se carga a mano lo justo para ejecutar `sh`.
const CHILD = "node:child_process";
interface Spawned {
  status: number | null;
  stdout: string;
  stderr: string;
}
const { spawnSync } = (await import(/* @vite-ignore */ CHILD)) as {
  spawnSync: (cmd: string, args: string[], opts: { encoding: "utf8"; env?: Record<string, string | undefined> }) => Spawned;
};
const FS = "node:fs";
const fs = (await import(/* @vite-ignore */ FS)) as {
  mkdtempSync: (prefix: string) => string;
  mkdirSync: (p: string, o?: { mode: number }) => void;
  chmodSync: (p: string, mode: number) => void;
  statSync: (p: string) => { mode: number };
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

const uid = Number(spawnSync("id", ["-u"], { encoding: "utf8" }).stdout.trim());
const sh = (script: string, tmp: string) => spawnSync("sh", ["-c", script], { encoding: "utf8", env: { ...env, TMPDIR: tmp, XDG_RUNTIME_DIR: "/run/user/0" } });
const user = (u: Partial<OwnerUser>): OwnerUser => ({ name: "deploy", uid, home: "/srv/deploy home", podman: true, docker: false, runtimeDir: false, ...u });

// ───────── Mismo texto que `runtime_fallback` en Rust ─────────
eq(
  runtimeFallback(1002),
  'd="${TMPDIR:-/tmp}/sshorus-run-1002"; mkdir -p -m 700 "$d" 2>/dev/null; if [ -L "$d" ] || [ "$(stat -c %u:%a "$d" 2>/dev/null)" != 1002:700 ]; then echo "La carpeta $d no es de este usuario o no tiene permisos 700: bórrala o usa otro TMPDIR" >&2; exit 1; fi; export XDG_RUNTIME_DIR="$d"',
  "texto igual que en Rust (tests_runtime.rs)",
);

// ───────── La línea de la terminal, ejecutada (sin `doas -u U`: aquí ya somos «él») ─────────
{
  const ctx: LineCtx = { engine: "podman", elevPrefix: "doas ", selfPrefix: "", runuser: false };
  const probe: Cmd = { bin: ["sh"], args: ["-c", 'printf "%s|%s" "$HOME" "$XDG_RUNTIME_DIR"'] };
  const asMe = (cmd: Cmd, u: OwnerUser) => {
    const line = ownerLine(cmd, { kind: "user", user: u }, ctx);
    const pre = `doas -u ${u.name} `;
    ok(line.startsWith(pre), `empieza con doas: ${line}`);
    return line.slice(pre.length);
  };

  const tmp = fs.mkdtempSync("/tmp/sshorus-ort-");
  const r = sh(asMe(probe, user({})), tmp);
  eq(r.status, 0, `sin sesión: funciona (${r.stderr})`);
  eq(r.stdout, `/srv/deploy home|${tmp}/sshorus-run-${uid}`, "su HOME y su carpeta propia, no la de root");
  eq(fs.statSync(`${tmp}/sshorus-run-${uid}`).mode & 0o777, 0o700, "modo 700");
  eq(sh(asMe(probe, user({})), tmp).status, 0, "la segunda vez reutiliza la carpeta");

  // Compose (con carpeta): el cd va dentro, después de preparar la carpeta.
  const cd: Cmd = { ...probe, cwd: "/" };
  eq(sh(asMe(cd, user({})), tmp).stdout, `/srv/deploy home|${tmp}/sshorus-run-${uid}`, "compose sin sesión");

  // Carpeta ajena o abierta: no se usa, error claro y no se ejecuta nada.
  const other = sh(asMe({ bin: ["echo"], args: ["NO"] }, user({ uid: uid + 1 })), tmp);
  eq(other.status, 1, "carpeta que no sale a su nombre");
  ok(!other.stdout.includes("NO") && other.stderr.includes("no es de este usuario"), `error claro: ${other.stderr}`);
  const open = fs.mkdtempSync("/tmp/sshorus-ort-");
  fs.mkdirSync(`${open}/sshorus-run-${uid}`);
  fs.chmodSync(`${open}/sshorus-run-${uid}`, 0o755);
  eq(sh(asMe({ bin: ["echo"], args: ["NO"] }, user({})), open).status, 1, "carpeta existente con 755");

  // Con sesión: /run/user/<uid> directo (línea corta, sin sh -c).
  eq(
    ownerLine(listContainers("podman"), { kind: "user", user: user({ uid: 1001, runtimeDir: true }) }, ctx),
    "doas -u deploy env HOME='/srv/deploy home' XDG_RUNTIME_DIR=/run/user/1001 podman ps -a --format json",
    "con sesión",
  );
  // Los mismos órdenes que en Rust: runuser, sudo -u, su.
  const ps = listContainers("podman");
  const d = user({ uid: 1002 });
  const inner = `env HOME='/srv/deploy home' sh -c '${runtimeFallback(1002).replace(/'/g, "'\\''")}; ${renderCmd(ps)}'`;
  eq(ownerLine(ps, { kind: "user", user: d }, { ...ctx, elevPrefix: "sudo ", runuser: true }), `sudo runuser -u deploy -- ${inner}`, "runuser");
  eq(ownerLine(ps, { kind: "user", user: d }, { ...ctx, elevPrefix: "sudo " }), `sudo -u deploy -H ${inner}`, "sudo -u");
  ok(ownerLine(ps, { kind: "user", user: d }, { ...ctx, elevPrefix: "" }).startsWith("su -s /bin/sh deploy -c 'env HOME="), "su");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(open, { recursive: true, force: true });
}

// ───────── Linger ─────────
{
  const owners: CtOwner[] = [
    { kind: "self" },
    { kind: "root" },
    { kind: "user", user: user({ name: "leo_oti", linger: false }) },
    { kind: "user", user: user({ name: "tesis", linger: true }) },
    { kind: "user", user: user({ name: "alpine", linger: null }) },
  ];
  eq(usersWithoutLinger(owners, "podman").map((u) => u.name), ["leo_oti"], "solo los que seguro no tienen linger");
  eq(usersWithoutLinger(owners, "docker"), [], "Docker: no aplica");
  eq(renderCmd(enableLingerCmd("leo_oti")), "loginctl enable-linger leo_oti", "comando");
  eq(enableLingerCmd("leo_oti").owner, undefined, "sin dueño: se ejecuta con elevationOverride, no como el usuario");
}

// ───────── Error de RunRoot de root, legible por usuario ─────────
{
  const raw =
    'time="2026-11-18T10:00:00-05:00" level=warning msg="RunRoot is pointing to a path (/run/containers/storage) which is not writable. Most likely podman will fail.: permission denied"\n' +
    'Error: cannot evaluate symlinks on DB run root path "/run/containers/storage": lstat /run/containers/storage: permission denied';
  eq(cleanEngineLog(raw), 'Error: cannot evaluate symlinks on DB run root path "/run/containers/storage": lstat /run/containers/storage: permission denied', "aviso fuera si hay error");
  eq(cleanEngineLog('time="x" level=warning msg="algo \\"raro\\""'), 'algo "raro"', "solo aviso: queda el texto");
  const t = translateError(raw);
  ok(t.startsWith("Podman de este usuario intenta usar la carpeta de ejecución de root") && t.includes("storage.conf"), t);
  ok(!t.includes("level=warning"), "sin la línea cruda del aviso");
  const m = mergeOwned([
    { owner: "u:leo_oti", label: "leo_oti", data: null, error: t },
    { owner: "u:tesis", label: "tesis", data: null, error: t },
  ]);
  const parts = (m.error ?? "").split(/\n\n(?=(?:leo_oti|tesis): )/);
  eq(parts.length, 2, "un bloque por usuario");
  ok(parts[0].startsWith("leo_oti: Podman de este usuario") && parts[1].startsWith("tesis: Podman de este usuario"), m.error ?? "");
}

console.log(`ownerRuntime: ${passed} comprobaciones OK`);
