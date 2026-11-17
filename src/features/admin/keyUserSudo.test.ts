// Pruebas de «Nuevo usuario con clave» con sudo: contraseña solo para sudo, sshd «solo llave» y servidor guardado.
// Ejecutar: npx rolldown src/features/admin/keyUserSudo.test.ts -p node -f esm -o /tmp/kus.mjs && node /tmp/kus.mjs
// Con KUS_SSHD=1 además ejecuta el plan como root en el contenedor de pruebas `terview-sshd` (podman), con un
// sshd_config de prueba (no toca el del servidor) y borra el usuario al final.
import type { ServerProfile } from "../../api/types";
import { buildExec } from "../privileges/elevate";
import { detectEnv, innerScript } from "./commands";
import { createKeyUserPlan } from "./keyUser";
import { keyUserServer, pickSudoPassword } from "./keyUserSudo";
import { generatePassword } from "./shell";
import { keyOnlyFile, keyOnlySshdSteps, RELOAD_SSHD_STEP, SSHD_CONFIG_D } from "./sshdConf";

declare const process: { env: Record<string, string | undefined> };
const nodeModule = (name: string) => import(/* @vite-ignore */ name);

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}

const ED = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICZm9C4sWqQjlgtug0eu7n8xh8h3oGFuNpS0Rq3vCc5z ana@casa";
const rocky = detectEnv(new Set(["useradd", "usermod", "chage"]), "rocky", ["rhel"], ["wheel"]);
const alpine = detectEnv(new Set(["adduser"]), "alpine", [], ["wheel"]);
const PW = "S3gura-'$(rm -rf /)'";
const base = { name: "ana", publicKey: ED, shell: "/bin/bash", groups: [], admin: true, linger: false };

// ── Plan con contraseña de sudo ──
const p = createKeyUserPlan(rocky, { ...base, sudoPassword: PW });
const script = innerScript(p);
eq(p.secret, `ana:${PW}\n`, "la contraseña va por stdin (chpasswd)");
ok(p.secretLabel && !p.secretLabel.includes(PW), "etiqueta enmascarada");
ok(!script.includes(PW) && !script.includes("S3gura"), "la contraseña no aparece en los comandos");
ok(!/NOPASSWD/i.test(script), "nunca NOPASSWD");
ok(p.steps.includes("chpasswd") && !p.steps.some((s) => s.includes("usermod -p '*'")), "chpasswd en vez de «*»");
const iSshd = p.steps.findIndex((s) => s.startsWith("  sshd -t"));
const iAdd = p.steps.findIndex((s) => s.startsWith("useradd"));
ok(iSshd >= 0 && iSshd < iAdd, "sshd «solo llave» antes de crear el usuario");
eq(p.steps[iAdd + 1], "chpasswd", "chpasswd justo después de useradd (primer paso que lee stdin)");
ok(p.steps.slice(0, iAdd).every((s) => !/\b(cat|read)\b/.test(s)), "antes de chpasswd nada lee stdin");
ok(script.includes(`'Match User ana'`) && script.includes(`'    AuthenticationMethods publickey'`), "Match User con solo publickey");
ok(script.includes(`> '${keyOnlyFile("ana")}'`) && keyOnlyFile("ana").startsWith(`${SSHD_CONFIG_D}/10-`), "archivo propio y temprano");
ok(script.includes("undo 'sshd -t falló"), "si sshd -t falla, se deshace");
ok(script.includes(`[ "$(eff root)" = "$antes" ]`), "comprueba que no cambia para otros usuarios");
ok(buildExec(script, { kind: "root" }, p.secret).stdin.endsWith(`ana:${PW}\n`), "stdin: script y luego usuario:clave");
const ap = createKeyUserPlan(alpine, { ...base, groups: ["sshusers"], sudoPassword: PW });
const ia = ap.steps.indexOf("adduser -D -s '/bin/bash' 'ana'");
eq(ap.steps.slice(ia, ia + 4), ["adduser -D -s '/bin/bash' 'ana'", "chpasswd", "addgroup 'ana' 'sshusers'", "addgroup 'ana' 'wheel'"], "busybox");

// Sin sudo (o sin contraseña): igual que antes, sin tocar sshd.
for (const u of [{ ...base, admin: false, sudoPassword: PW }, { ...base, sudoPassword: "" }]) {
  const np = createKeyUserPlan(rocky, u);
  eq(np.secret, undefined, "sin secreto");
  ok(np.steps.includes("usermod -p '*' 'ana'") && !np.steps.some((s) => s.includes("sshd")), "sin contraseña ni sshd");
}
ok(keyOnlySshdSteps("ana").join("\n").includes(RELOAD_SSHD_STEP.split("\n")[0]), "recarga sshd");

// ── Contraseña generada o escrita ──
const g = generatePassword();
ok(g.length === 20 && /[0-9]/.test(g) && /[-_.+=@%]/.test(g), "generada: 20 caracteres con número y símbolo");
eq(pickSudoPassword("generate", "", "ya-generada"), { ok: true, password: "ya-generada" }, "reutiliza la generada");
eq(pickSudoPassword("generate", "", "", () => "nueva"), { ok: true, password: "nueva" }, "genera si no hay");
eq(pickSudoPassword("type", "corta", "x").ok, false, "escrita: mínimo 8");
eq(pickSudoPassword("type", "otra-buena-1", "x"), { ok: true, password: "otra-buena-1" }, "escrita válida");

// ── Servidor que se guarda ──
const srv: ServerProfile = { id: "abc", name: "VPS", host: "h", port: 22, username: "root", auth: "password", keyPath: null, defaultPath: "/srv", color: "#f00", sudoMode: "login" };
const withPw = keyUserServer(srv, "ana", "/home/yo/.ssh/id_ana", PW);
eq(withPw.server, { ...srv, id: "", name: "VPS (ana)", username: "ana", auth: "key", keyPath: "/home/yo/.ssh/id_ana", sudoMode: "saved" }, "servidor con «Guardar»");
eq(withPw.sudoSecret, PW, "se guarda la contraseña de sudo");
const noPw = keyUserServer(srv, "ana", "", null);
eq([noPw.server.auth, noPw.server.keyPath, noPw.server.sudoMode, noPw.sudoSecret], ["agent", null, "ask", undefined], "sin contraseña: «Pedir cada vez»");

// ── De verdad en el contenedor de pruebas (KUS_SSHD=1) ──
if (process.env.KUS_SSHD) {
  const { execFileSync } = await nodeModule("node:child_process");
  const D = "/config/tmp-keyuser-test";
  const run = (cmd: string, input = "") =>
    execFileSync("podman", ["exec", "-i", "terview-sshd", "sh", "-c", cmd], { input, stdio: ["pipe", "pipe", "pipe"] }).toString();
  // sshd_config de prueba: Include al principio, contraseña permitida para todos y un Match posterior que la permite.
  run(
    `rm -rf ${D}; mkdir -p ${D}/d; printf '%s\\n' 'Include ${D}/d/*.conf' 'HostKey /config/ssh_host_keys/ssh_host_ed25519_key' 'PasswordAuthentication yes' 'Match Address 127.0.0.0/8' '  PasswordAuthentication yes' > ${D}/sshd_config`,
  );
  const real = (pl: typeof p) =>
    innerScript(pl)
      .split(SSHD_CONFIG_D)
      .join(`${D}/d`)
      .replace(/\bsshd -(t <|T -C)/g, `sshd.pam -f ${D}/sshd_config -$1`)
      .replace(RELOAD_SSHD_STEP.replace(/^/gm, "  "), "  :"); // sin systemd ni OpenRC en el contenedor
  // Como en la app: arranque corto + script por stdin (dd) + «usuario:clave» detrás.
  const runPlan = (pl: typeof p) => {
    const req = buildExec(real(pl), { kind: "root" }, pl.secret);
    return run(req.command, req.stdin);
  };
  const pw = generatePassword();
  for (const env of [rocky, alpine]) {
    const user = "kus-ana";
    const pl = createKeyUserPlan(env, { ...base, name: user, sudoPassword: pw });
    try {
      runPlan(pl);
      const eff = run(`/usr/sbin/sshd.pam -T -f ${D}/sshd_config -C user=${user},host=localhost,addr=127.0.0.1`);
      ok(/^authenticationmethods publickey$/m.test(eff) && /^passwordauthentication no$/m.test(eff), `${env.toolset}: solo llave para ${user}`);
      const other = run(`/usr/sbin/sshd.pam -T -f ${D}/sshd_config -C user=root,host=localhost,addr=127.0.0.1`);
      ok(/^passwordauthentication yes$/m.test(other), `${env.toolset}: los demás siguen igual`);
      ok(/^\$/.test(run(`awk -F: '$1 == "${user}" { print $2 }' /etc/shadow`)), `${env.toolset}: tiene contraseña (hash)`);
      eq(run(`cat /home/${user}/.ssh/authorized_keys`), `${ED}\n`, `${env.toolset}: authorized_keys`);
      // En el contenedor el grupo wheel no tiene sudo: regla temporal CON contraseña (nunca NOPASSWD).
      run(`printf '%s\\n' '${user} ALL=(ALL) ALL' > /etc/sudoers.d/kus-test; chmod 440 /etc/sudoers.d/kus-test`);
      const sudo = (input: string) => run(`su ${user} -s /bin/sh -c 'sudo -k -S -p "" id -u' 2>&1 || true`, input);
      eq(sudo(`${pw}\n`).trim().split("\n").pop(), "0", `${env.toolset}: sudo funciona con la contraseña`);
      ok(/incorrect|try again/i.test(sudo("mala\nmala\nmala\n")), `${env.toolset}: sudo rechaza otra`);
    } finally {
      run(`rm -f /etc/sudoers.d/kus-test; deluser --remove-home ${user} 2>/dev/null || userdel -r ${user} 2>/dev/null; rm -f ${D}/d/*.conf`);
    }
  }
  // sshd -t falla → se deshace y no se crea el usuario.
  const bad = createKeyUserPlan(rocky, { ...base, name: "kus-bad", sudoPassword: pw });
  run(`printf 'NoExiste yes\\n' > ${D}/d/99-roto.conf`);
  let failed = "";
  try {
    runPlan(bad);
  } catch (e) {
    failed = String((e as { stderr?: unknown }).stderr ?? e);
  }
  ok(failed.includes("sshd -t falló"), `sshd -t roto: ${failed}`);
  ok(run(`id kus-bad >/dev/null 2>&1 && echo si || echo no`).trim() === "no", "no se creó el usuario");
  ok(run(`ls ${D}/d`).trim() === "99-roto.conf", "archivo propio borrado");
  run(`rm -rf ${D}`);
}

console.log(`keyUserSudo: ${passed} comprobaciones correctas`);
