// Pruebas de «Claude Code en este servidor con tu cuenta»: estado, comandos de la terminal, la llave y los
// scripts de ver y quitar, ejecutados de verdad con sh en una carpeta personal de prueba.
// Ejecutar: npm test -- claudeVps
import * as layout from "./layout";
import { activeMode, cleanToken, currentAccount, installCommand, launchCommand, looksLikeToken, MODES } from "./model";
import { REMOVE_SCRIPT, STATUS_SCRIPT, parseRemove, parseStatus } from "./scripts";

declare const process: { exit(code: number): never };
const nodeModule = (name: string) => import(/* @vite-ignore */ name);

let passed = 0;
function ok(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}
function eq<T>(a: T, b: T, what: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}

// ───────── Estado ─────────
const st = parseStatus("user=leo\nhome=/home/leo\nshell=bash\nclaude=/home/leo/.local/bin/claude\nversion=2.1.0 (Claude Code)\ntoken=1\ncurl=1\nbash=1\nend=1\n");
ok(st, "estado completo");
eq([st?.user, st?.onPath, st?.token, st?.session, st?.version], ["leo", false, true, false, "2.1.0 (Claude Code)"], "campos del estado");
eq(parseStatus("user=leo\n"), null, "sin end=1 no está entero");

// ───────── Comandos que se escriben en la terminal ─────────
if (!st) process.exit(1);
eq(launchCommand(st, "session"), "~/.local/bin/claude", "fuera del PATH se abre con su ruta");
eq(launchCommand({ ...st, onPath: true }, "token"), '. "$HOME/.config/sshorus/claude-env.sh"; claude', "con la llave, primero se carga");
eq(launchCommand({ ...st, onPath: true, shell: "fish" }, "token"), "set -gx CLAUDE_CODE_OAUTH_TOKEN (cat ~/.config/sshorus/claude-token); claude", "fish");
ok(!launchCommand(st, "token").includes("sk-ant"), "la llave nunca se escribe en la terminal");
eq(installCommand({ curl: true, wget: true, bash: true }), "curl -fsSL https://claude.ai/install.sh | bash", "instalador oficial con curl");
eq(installCommand({ curl: false, wget: true, bash: true }), "wget -qO- https://claude.ai/install.sh | bash", "con wget");
eq(installCommand({ curl: true, wget: false, bash: false }), null, "sin bash no se ofrece");
eq([activeMode({ session: true, token: true }), activeMode({ session: true, token: false }), activeMode({ session: false, token: false })], ["token", "session", null], "modo para abrir");
ok(currentAccount({ session: false, token: true })?.includes("llave"), "cuenta actual");
eq(MODES.map((m) => m.mode), ["token", "session"], "la recomendada primero");
ok(MODES.every((m) => !m.line.includes("\n") && m.line.length < 140), "una línea cada una");

// ───────── La llave ─────────
const token = `sk-ant-oat01-${"b".repeat(95)}`;
eq(cleanToken(`  ${token.slice(0, 30)}\n${token.slice(30)}\r\n`), token, "se unen los trozos que partió la terminal");
ok(looksLikeToken(token) && !looksLikeToken("sk-ant-oat01-corta") && !looksLikeToken(`sk-ant-api03-${"b".repeat(95)}`), "forma de la llave");

// ───────── Los nombres coinciden con los scripts del motor ─────────
const { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } = await nodeModule("node:fs");
const { join } = await nodeModule("node:path");
const { tmpdir } = await nodeModule("node:os");
const { execFileSync } = await nodeModule("node:child_process");
const rust: string = readFileSync("src-tauri/src/localterm/claude_vps/scripts.rs", "utf8");
for (const p of [layout.TOKEN_FILE, layout.ENV_FILE, layout.SESSION_MARK, layout.BACKUP_FILE, layout.CREDS_FILE, layout.FISH_FILE]) {
  ok(rust.includes(p.split("/").pop() ?? "?"), `el motor escribe ${p}`);
}
ok(rust.includes(layout.RC_MARK) && rust.includes(".config/sshorus"), "misma marca y carpeta en el motor");
ok(rust.includes(`for f in ${layout.RC_FILES.join(" ")}; do`), "mismos archivos de inicio");

// ───────── Los scripts de verdad ─────────
const home: string = mkdtempSync(join(tmpdir(), "sshorus-cvps-"));
const sh = (script: string) => execFileSync("/bin/sh", ["-c", script], { encoding: "utf8", env: { HOME: home, PATH: "/usr/bin:/bin", SHELL: "/bin/bash" } }) as string;
try {
  // Lo que dejan los scripts del motor (sesión copiada sobre una propia, y la llave).
  mkdirSync(join(home, ".config/sshorus"), { recursive: true });
  mkdirSync(join(home, ".config/fish/conf.d"), { recursive: true });
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude/.credentials.json"), "COPIADA");
  writeFileSync(join(home, ".config/sshorus/claude-credentials-antes.json"), "PROPIA");
  writeFileSync(join(home, ".config/sshorus/claude-session"), "");
  writeFileSync(join(home, ".config/sshorus/claude-token"), "LLAVE");
  writeFileSync(join(home, ".config/sshorus/claude-env.sh"), "x");
  writeFileSync(join(home, ".config/fish/conf.d/sshorus-claude.fish"), "x");
  const line = `if [ -r x ]; then . x; fi ${layout.RC_MARK}`;
  writeFileSync(join(home, ".bashrc"), `alias ll=ls\n${line}\nexport A=1\n`);
  writeFileSync(join(home, ".profile"), `${line}\n`);

  const before = parseStatus(sh(STATUS_SCRIPT));
  eq([before?.session, before?.token, before?.creds, before?.home], [true, true, true, home], "el estado lo ve todo");

  eq(parseRemove(sh(REMOVE_SCRIPT)), { session: true, token: true, restored: true }, "quitar dice qué quitó");
  eq(readFileSync(join(home, ".claude/.credentials.json"), "utf8"), "PROPIA", "se repone la sesión que había");
  eq(readFileSync(join(home, ".bashrc"), "utf8"), "alias ll=ls\nexport A=1\n", "solo se quita la línea de SSHorus");
  eq(readFileSync(join(home, ".profile"), "utf8"), "", "y de .profile");
  ok(!existsSync(join(home, ".config/sshorus")) && !existsSync(join(home, ".config/fish/conf.d/sshorus-claude.fish")), "no queda nada de SSHorus");

  // Sin sesión propia: se borra la copiada. Una sesión que no puso SSHorus no se toca.
  eq(parseRemove(sh(REMOVE_SCRIPT)), { session: false, token: false, restored: false }, "quitar dos veces no falla");
  ok(existsSync(join(home, ".claude/.credentials.json")), "la sesión propia sigue");
  mkdirSync(join(home, ".config/sshorus"), { recursive: true });
  writeFileSync(join(home, ".config/sshorus/claude-session"), "");
  sh(REMOVE_SCRIPT);
  ok(!existsSync(join(home, ".claude/.credentials.json")), "la copiada sin respaldo se borra");
} finally {
  rmSync(home, { recursive: true, force: true });
}

console.log(`${passed} comprobaciones`);
