// Pruebas de «Añadir a SSHorus»: lectura de llaves/sudo/contraseñas, candidatos, perfiles y plan de llave.
// Ejecutar: npx rolldown src/features/admin/importUsers.test.ts -p node -f esm -o /tmp/iu.mjs && node /tmp/iu.mjs
import type { ServerProfile } from "../../api/types";
import { buildUserRows, parseRead } from "./parse";
import {
  buildCandidates,
  findExistingServer,
  findLocalPublicKey,
  importedProfile,
  installKeyPlan,
  isLoginShell,
  namesToRead,
  parseUserAccess,
  passwordState,
  userAccessScript,
} from "./importUsers";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}

const ED = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICZm9C4sWqQjlgtug0eu7n8xh8h3oGFuNpS0Rq3vCc5z ana@portátil";

function server(id: string, host: string, username: string, port = 22): ServerProfile {
  return { id, name: id, host, port, username, auth: "password", keyPath: null, defaultPath: "/srv", color: "#f00", tmux: "auto", sudoMode: "login" };
}

// ── Shells ──
ok(isLoginShell("/bin/bash"), "bash entra");
ok(isLoginShell("/usr/bin/zsh"), "zsh entra");
ok(!isLoginShell("/sbin/nologin"), "nologin no");
ok(!isLoginShell("/usr/sbin/nologin"), "nologin (usr) no");
ok(!isLoginShell("/bin/false"), "false no");
ok(!isLoginShell("/usr/bin/git-shell"), "git-shell no");
ok(!isLoginShell(""), "vacío no");

// ── Contraseña (estado de /etc/shadow, sin hashes) ──
eq(["P", "L", "NP", "NL", null].map((s) => passwordState(s as never)), ["active", "locked", "empty", "none", "unknown"], "estados");

// ── Script: nombres citados, nunca saca hashes ──
const script = userAccessScript(["ana", "o'brien"]);
ok(script.includes(`for u in 'ana' 'o'\\''brien'; do`), "nombres citados");
ok(script.includes("@@shadow") && script.trimEnd().endsWith("echo @@end"), "incluye shadow y termina en @@end");
ok(!/print \$2/.test(script), "no imprime el campo del hash");
ok(userAccessScript([]).includes("for u in ; do"), "lista vacía válida");

// ── Parseo ──
const out = ["@@access", "ana:2:1", "beto:0:0", "caro:?:-", "roto", "@@shadow", "ana:P:19000::", "beto:L:19000::", "caro:NL:19000::", "@@end"].join("\n");
const acc = parseUserAccess(out);
eq(acc.access.get("ana"), { keys: 2, sudo: true }, "ana");
eq(acc.access.get("beto"), { keys: 0, sudo: false }, "beto");
eq(acc.access.get("caro"), { keys: null, sudo: null }, "caro sin saber");
eq(acc.access.has("roto"), false, "línea rota ignorada");
eq(acc.shadow.get("beto")?.status, "L", "shadow");
let threw = false;
try {
  parseUserAccess("@@access\nana:1:1");
} catch {
  threw = true;
}
ok(threw, "sin @@end falla");

// ── Candidatos ──
const read = parseRead(
  [
    "@@me",
    "test",
    "@@passwd",
    "root:x:0:0:root:/root:/bin/bash",
    "daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin",
    "test:x:1000:1000::/config:/bin/bash",
    "ana:x:1001:1001:Ana Pérez,,,:/home/ana:/bin/bash",
    "beto:x:1002:1002::/home/beto:/bin/bash",
    "caro:x:1003:1003::/home/caro:/bin/zsh",
    "sftp:x:1004:1004::/home/sftp:/usr/sbin/nologin",
    "nobody:x:65534:65534:nobody:/:/usr/sbin/nologin",
    "@@group",
    "wheel:x:10:caro",
    "@@end",
  ].join("\n"),
);
const users = buildUserRows(read, null);
eq(namesToRead(users), ["root", "test", "ana", "beto", "caro"], "lee root y los que pueden entrar");
const servers = [server("s1", "Web.example.com", "test"), server("s2", "web.example.com", "ana", 2222)];
const c = buildCandidates({ users, read: acc, servers, host: "web.example.com ", port: 22 });
const by = (n: string) => c.find((x) => x.name === n)!;
eq(c[0].name, "root", "root primero");
eq(by("root").kind, "root", "root aparte");
eq(by("root").suggested, false, "root sin marcar");
eq(by("root").blocked, null, "root se puede elegir");
eq(by("daemon").kind, "system", "daemon del sistema");
ok(by("daemon").blocked !== null && !by("daemon").suggested, "sistema no se elige");
eq(by("nobody").kind, "system", "nobody del sistema");
ok(by("test").existing?.id === "s1" && by("test").blocked?.includes("Ya está en SSHorus"), "test ya guardado (host sin mayúsculas)");
eq(by("ana").existing, null, "ana en otro puerto: no cuenta");
eq([by("ana").suggested, by("ana").keys, by("ana").password, by("ana").sudo], [true, 2, "active", true], "ana marcada");
eq(by("ana").fullName, "Ana Pérez", "nombre completo");
eq([by("beto").suggested, by("beto").password], [false, "locked"], "beto: bloqueado y sin llaves");
eq([by("caro").suggested, by("caro").sudo], [true, true], "caro: no se sabe, se marca; sudo por grupo");
ok(by("sftp").blocked?.startsWith("No puede abrir sesión") && !by("sftp").suggested, "nologin no se elige");
const noRead = buildCandidates({ users, read: null, servers: [], host: "x", port: 22 });
eq(noRead.find((x) => x.name === "beto")!.suggested, true, "sin lectura: se marcan los normales");

// ── Servidor ya guardado ──
eq(findExistingServer([server("a", "h", "u", 0)], "H", 22, "u")?.id, "a", "puerto 0 = 22");
eq(findExistingServer([server("a", "h", "u")], "h", 22, "U"), null, "usuario distingue mayúsculas");

// ── Perfil nuevo ──
const base = server("base", "web.example.com", "test", 2200);
const pk = importedProfile(base, "ana", { kind: "key", keyPath: " ~/.ssh/id_ed25519 " });
eq(
  [pk.id, pk.name, pk.host, pk.port, pk.username, pk.auth, pk.keyPath, pk.defaultPath, pk.sudoMode, pk.color, pk.tmux],
  ["", "base (ana)", "web.example.com", 2200, "ana", "key", "~/.ssh/id_ed25519", null, "ask", "#f00", "auto"],
  "perfil con llave",
);
eq([importedProfile(base, "ana", { kind: "key", keyPath: "" }).auth, importedProfile(base, "ana", { kind: "key", keyPath: "" }).keyPath], ["agent", null], "llave vacía = agente");
const pp = importedProfile({ ...base, auth: "key", keyPath: "/k" }, "beto", { kind: "password" });
eq([pp.auth, pp.keyPath], ["password", null], "perfil con contraseña");

// ── Llave pública local ──
const locals = [
  { path: "/home/u/.ssh/id_rsa.pub", privatePath: "/home/u/.ssh/id_rsa", line: "ssh-rsa AAAA x" },
  { path: "/home/u/.ssh/id_ed25519.pub", privatePath: "/home/u/.ssh/id_ed25519", line: ED },
  { path: "/home/u/.ssh/suelta.pub", privatePath: null, line: "ssh-ed25519 AAAA y" },
];
eq(findLocalPublicKey(locals, "~/.ssh/id_ed25519")?.line, ED, "con ~");
eq(findLocalPublicKey(locals, "/home/u/.ssh/id_rsa")?.path, "/home/u/.ssh/id_rsa.pub", "ruta absoluta");
eq(findLocalPublicKey(locals, "~/.ssh/otra"), null, "no existe");
eq(findLocalPublicKey(locals, ""), null, "vacía");

// ── Plan para instalar la llave ──
const plan = installKeyPlan(["ana", "o'b"], ED);
ok(typeof plan !== "string", "plan válido");
if (typeof plan !== "string") {
  const s = plan.steps.join("\n");
  ok(plan.action.includes("«ana»") && plan.action.includes("ana@portátil"), "acción legible");
  ok(s.includes(`grep -qF -- 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICZm9C4sWqQjlgtug0eu7n8xh8h3oGFuNpS0Rq3vCc5z' "$f"`), "sin duplicar (tipo + base64)");
  ok(s.includes(`chmod g-s,u=rwx,go= "$d"`) && s.includes(`chmod 600 "$t"`), "permisos 700 y 600");
  ok(s.includes(`chown 'o'\\''b':"$g" "$d"`), "dueño citado");
  ok(!plan.secret, "nada secreto");
}
ok(typeof installKeyPlan(["ana"], "-----BEGIN OPENSSH PRIVATE KEY-----") === "string", "privada rechazada");

console.log(`importUsers: ${passed} comprobaciones correctas`);
