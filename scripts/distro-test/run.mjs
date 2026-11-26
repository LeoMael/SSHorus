// Batería de pruebas por distro: arranca un contenedor efímero de cada distro con podman (sin root), le
// pasa los scripts remotos REALES de SSHorus (los de src/ y los del escáner, que salen del motor) como lo
// haría una conexión SSH (usuario normal, PATH corto, sudo con contraseña por stdin) y pasa la salida por
// los mismos parseadores de la app. No va en la CI (descarga imágenes).
//
//   npm run test:distros                    → todas
//   npm run test:distros -- debian alpine   → solo esas
//   Opciones: --sin-rust (sin el escáner, no compila), --conservar-imagenes (no borra las que descargó),
//             --conservar-salidas (deja las salidas en la carpeta temporal y dice dónde),
//             --detalle (enseña también lo que no sale bien en la auditoría, para revisarlo a mano)
//
// Necesita podman y, salvo con --sin-rust, cargo (en esta máquina: CARGO_BUILD_JOBS=3 CARGO_INCREMENTAL=0).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "rolldown";
import { DISTROS, PASSWORD, USER } from "./distros.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const wanted = args.filter((a) => !a.startsWith("--"));
const withRust = !flag("--sin-rust");
const distros = DISTROS.filter((d) => wanted.length === 0 || wanted.includes(d.id));
if (distros.length === 0) {
  console.error(`No hay distros con ese nombre. Disponibles: ${DISTROS.map((d) => d.id).join(", ")}`);
  process.exit(1);
}

const sh = (cmd, cmdArgs, opts = {}) => spawnSync(cmd, cmdArgs, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });

if (sh("podman", ["--version"]).status !== 0) {
  console.error("Hace falta podman (sin root) para esta batería.");
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "sshorus-distros-"));
const pulled = [];
const containers = new Set();

function cleanup() {
  for (const c of containers) sh("podman", ["rm", "-f", "-t", "0", c]);
  containers.clear();
  if (!flag("--conservar-imagenes")) for (const img of pulled.splice(0)) sh("podman", ["rmi", "-f", img]);
  if (!flag("--conservar-salidas")) rmSync(work, { recursive: true, force: true });
}
process.on("SIGINT", () => {
  console.log("\nInterrumpido: limpiando contenedores…");
  cleanup();
  process.exit(130);
});

/** Empaqueta areas.ts para Node (como scripts/run-ts-tests.mjs) y lo importa. */
async function loadAreas() {
  const file = join(work, "areas.mjs");
  const onLog = (level, log, handler) => log.code !== "MODULE_LEVEL_DIRECTIVE" && handler(level, log);
  await build({ input: join(root, "scripts/distro-test/areas.ts"), platform: "node", onLog, output: { file, format: "esm" } });
  return import(pathToFileURL(file).href);
}

function cargo(test) {
  console.log(`  cargo test ${test}…`);
  const r = sh("cargo", ["test", "--lib", "--locked", `vulnscan::tests_distros::${test}`, "--", "--ignored", "--exact"], {
    cwd: join(root, "src-tauri"),
    env: { ...process.env, SSHORUS_DISTRO_DIR: work },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.status !== 0) throw new Error(`cargo test ${test} falló:\n${(r.stderr || r.stdout).slice(-3000)}`);
}

/**
 * Lo que haría el canal exec de SSH: el shell de login del usuario con `-c`, un entorno limpio y el PATH
 * más corto habitual (el de Debian: sin /usr/sbin), y el script por stdin.
 */
function execAsUser(ctr, d, run) {
  const env = [`HOME=/home/${USER}`, `USER=${USER}`, `LOGNAME=${USER}`, `SHELL=${d.shell}`, "PATH=/usr/local/bin:/usr/bin:/bin:/usr/games", "LANG=C.UTF-8"];
  const r = sh("podman", ["exec", "-i", "-u", USER, "-w", `/home/${USER}`, ctr, "/usr/bin/env", "-i", ...env, d.shell, "-c", run.command], {
    input: run.stdin,
    timeout: run.timeoutSecs * 1000,
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status, timedOut: r.error?.code === "ETIMEDOUT" };
}

function prepare(d) {
  if (sh("podman", ["image", "exists", d.image]).status !== 0) {
    console.log(`  descargando ${d.image}…`);
    const p = sh("podman", ["pull", "-q", d.image], { stdio: ["ignore", "pipe", "pipe"] });
    if (p.status !== 0) throw new Error(`no se pudo descargar ${d.image}: ${p.stderr.trim()}`);
    pulled.push(d.image);
  }
  const name = `sshorus-distro-${d.id}-${process.pid}`;
  const run = sh("podman", ["run", "-d", "--rm", "--name", name, d.image, "sleep", "3600"]);
  if (run.status !== 0) throw new Error(`no arrancó el contenedor: ${run.stderr.trim()}`);
  containers.add(name);
  console.log("  preparando (paquetes, usuario, sshd)…");
  const s = sh("podman", ["exec", "-i", name, "sh", "-e", "-s"], { input: d.setup, timeout: 900_000 });
  if (s.status !== 0) throw new Error(`la preparación falló (código ${s.status}): ${(s.stderr || s.stdout).trim().slice(-800)}`);
  return name;
}

function stop(name) {
  sh("podman", ["rm", "-f", "-t", "0", name]);
  containers.delete(name);
}

/** Resultado: distro → [{ area, label, ok, detail }]. */
const results = new Map();

async function main() {
  const df = sh("df", ["-h", "/"]).stdout.trim().split("\n").pop();
  console.log(`Disco antes: ${df}`);
  const mod = await loadAreas();
  let vulnScripts = null;
  if (withRust) {
    cargo("distro_scripts_dump");
    const read = (n) => readFileSync(join(work, "scripts", `${n}.sh`), "utf8");
    vulnScripts = { detect: read("detect"), users: read("users"), inventory: read("inventory") };
  }
  for (const d of distros) {
    console.log(`\n▶ ${d.id} (${d.image})`);
    const rows = [];
    results.set(d.id, rows);
    const e = { ...d.expect, user: USER, password: PASSWORD };
    let ctr;
    try {
      ctr = prepare(d);
    } catch (err) {
      rows.push({ area: "setup", label: "Preparación", ok: false, detail: err.message });
      continue;
    }
    try {
      for (const area of mod.AREAS) {
        const outs = area.runs(e).map((run) => execAsUser(ctr, d, run));
        rows.push({ area: area.id, label: area.label, ...mod.judge(area, outs, e) });
        const v = rows.at(-1);
        console.log(`  ${v.ok ? "✓" : "✗"} ${area.label}: ${v.detail}`);
        if (flag("--detalle")) for (const l of v.extra ?? []) console.log(`      ${l}`);
      }
      if (vulnScripts) {
        const dir = join(work, "out", d.id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "expect.txt"), Object.entries({ os: d.expect.osId, user: USER, ...d.rust }).map(([k, v]) => `${k}=${v}`).join("\n"));
        for (const { name, run } of mod.vulnRuns(vulnScripts, e)) {
          const r = execAsUser(ctr, d, run);
          writeFileSync(join(dir, `vuln-${name}.txt`), r.stdout);
          if (r.exitCode !== 0 && r.stderr.trim()) writeFileSync(join(dir, `vuln-${name}.err`), r.stderr);
        }
      }
    } finally {
      stop(ctr);
    }
  }
  if (vulnScripts) {
    cargo("distro_outputs_check");
    for (const d of distros) {
      let tsv = "";
      try {
        tsv = readFileSync(join(work, "out", d.id, "rust.tsv"), "utf8");
      } catch {
        continue;
      }
      for (const line of tsv.trim().split("\n")) {
        const [area, ok, detail] = line.split("\t");
        results.get(d.id).push({ area, label: `Escáner (${area.replace("vuln-", "")})`, ok: ok === "ok", detail });
      }
    }
  }
}

function report() {
  console.log("\n══════ Informe por distro ══════");
  for (const [id, rows] of results) {
    console.log(`\n${id}`);
    for (const r of rows) console.log(`  ${r.ok ? "✓" : "✗"} ${r.label.padEnd(22)} ${r.detail}`);
  }
  const areas = [...new Set([...results.values()].flatMap((rows) => rows.map((r) => r.area)))];
  console.log(`\n${"".padEnd(10)}${areas.map((a) => a.padEnd(15)).join("")}`);
  for (const [id, rows] of results) {
    const cell = (a) => {
      const r = rows.find((x) => x.area === a);
      return (r ? (r.ok ? "✓" : "✗") : "·").padEnd(15);
    };
    console.log(`${id.padEnd(10)}${areas.map(cell).join("")}`);
  }
  const bad = [...results.values()].flat().filter((r) => !r.ok).length;
  console.log(bad ? `\n${bad} comprobaciones fallaron.` : "\nTodo correcto.");
  return bad;
}

let failures = 1;
try {
  await main();
  failures = report();
} catch (err) {
  console.error(`\n${err.message}`);
} finally {
  if (flag("--conservar-salidas")) console.log(`Salidas en ${work}`);
  cleanup();
  console.log(`Disco después: ${sh("df", ["-h", "/"]).stdout.trim().split("\n").pop()}`);
}
process.exit(failures ? 1 : 0);
