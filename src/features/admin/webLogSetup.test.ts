// Pruebas del script completo «Activar / Quitar registro de visitas» (copia, carpeta, SELinux, editar,
// validar, recargar, visita de prueba, restaurar si falla o se cancela) con programas falsos en el
// PATH, y de cómo se explica el resultado. Ejecutar: npm test -- webLogSetup
import type { ServerInfo, Site } from "./web";
import {
  AVC_DENIED,
  CADDY26_VALIDATE_ERROR,
  CADDY_RELOAD_DENIED,
  CADDY_SITES,
  CADDYFILE,
  NGINX_EMERG,
  NGINX_SELINUX_DENIED,
  NGINX_SITES,
} from "./webLogFixtures";
import { failingLine, LogStepStream, readLogRun } from "./webLogResult";
import { probeCommand, siteLogPlan, type SiteLogPlan } from "./webTrafficSetup";

type Env = Record<string, string | undefined>;
const CHILD = "node:child_process";
const { spawnSync } = (await import(/* @vite-ignore */ CHILD)) as {
  spawnSync: (
    cmd: string,
    args: string[],
    opts: { encoding: "utf8"; env: Env; timeout?: number; killSignal?: string },
  ) => { status: number | null; stdout: string; stderr: string };
};
const FS = "node:fs";
const fs = (await import(/* @vite-ignore */ FS)) as {
  mkdtempSync: (prefix: string) => string;
  mkdirSync: (p: string, o?: { recursive: boolean }) => void;
  writeFileSync: (p: string, s: string, o?: { mode?: number }) => void;
  readFileSync: (p: string, enc: "utf8") => string;
  readdirSync: (p: string) => string[];
  existsSync: (p: string) => boolean;
  rmSync: (p: string, o: { recursive: boolean; force: boolean }) => void;
};
const env = (globalThis as unknown as { process: { env: Env } }).process.env;

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}

// --- Explicar el resultado (salidas reales) -----------------------------------------------------
{
  eq(failingLine(NGINX_EMERG), 'nginx: [emerg] unknown directive "acess_log" in /etc/nginx/conf.d/sites.conf:13', "nginx: la línea [emerg]");
  eq(failingLine(CADDY26_VALIDATE_ERROR), "Error: adapting config using caddyfile: /etc/caddy/sites/api.caddy:3: unrecognized directive: bogus_directive", "Caddy 2.6: «Error:»");
  ok(failingLine(CADDY_RELOAD_DENIED)?.startsWith("sending configuration to instance: caddy responded with error"), "Caddy 2.11: el «msg» del JSON");

  const steps: string[] = [];
  let text = "";
  const s = new LogStepStream((k) => steps.push(k), (t) => (text += t));
  for (const chunk of ["@@pa", "so check\nhola\n@@estado chan", "ged\n@@selinux type=AVC x\n@@paso valid", "ate\nfin"]) s.push(chunk);
  s.end();
  eq(steps, ["check", "validate"], "los pasos llegan aunque la marca venga partida");
  eq(text, "hola\ntype=AVC x\nfin\n", "la salida sin marcas (SELinux sí se enseña)");
}

const tmp = fs.mkdtempSync("/tmp/sshorus-wls-");
try {
  // Programas falsos: lo que hacen lo deciden variables de entorno; anotan sus llamadas en $CALLS.
  const bin = `${tmp}/bin`;
  fs.mkdirSync(bin, { recursive: true });
  const fake = (name: string, body: string) => fs.writeFileSync(`${bin}/${name}`, `#!/bin/sh\necho "${name} $*" >> "$CALLS"\n${body}\n`, { mode: 0o755 });
  const check = [
    'if [ -n "$SLOW" ] && grep -rq sshorus-traffic-log "$CFG"; then sleep 3; fi',
    '[ -n "$BROKEN" ] && { printf "%s\\n" "$BROKEN"; exit 1; }',
    'if [ -n "$BAD_NEW" ] && grep -rq sshorus-traffic-log "$CFG"; then printf "%s\\n" "$BAD_NEW"; exit 1; fi',
    "echo ok",
  ].join("\n");
  fake("caddy", `case "$1" in validate) ${check.replace(/\n/g, "\n")} ;; esac`);
  fake("nginx", `case "$1" in -t) ${check} ;; esac`);
  fake("systemctl", '[ -n "$RELOAD_FAIL" ] && { printf "%s\\n" "$RELOAD_FAIL"; exit 1; }; exit 0');
  fake("curl", '[ -n "$NO_WRITE" ] || echo "visita de prueba" >> "$LOG"');
  fake("ps", 'case "$*" in *-C*) [ -n "$PS_USER" ] && echo "$PS_USER" ;; *label*) [ -n "$PS_LABEL" ] && echo "$PS_LABEL" ;; esac; exit 0');
  fake("id", "exit 1");
  fake("chown", "exit 0");
  fake("selinuxenabled", '[ -n "$SELINUX" ]');
  fake("restorecon", "exit 0");
  fake("semanage", "exit 0");
  fake("stat", 'echo "$DIR_CTX"');
  fake("ausearch", '[ -n "$AVC" ] && printf "%s\\n" "$AVC"; exit 0');

  const backups = `${tmp}/backups`;
  /** El script de verdad, con /var/log y /var/backups dentro de la carpeta de la prueba. */
  const sandbox = (plan: SiteLogPlan) =>
    plan.script.replaceAll("/var/log/caddy", `${tmp}/log-caddy`).replaceAll("/var/log/nginx", `${tmp}/log-nginx`).replaceAll("/var/backups/sshorus", backups);
  const run = (plan: SiteLogPlan, cfg: string, extra: Env = {}, timeout?: number) => {
    const log = plan.logPath.replace("/var/log/caddy", `${tmp}/log-caddy`).replace("/var/log/nginx", `${tmp}/log-nginx`);
    fs.writeFileSync(`${tmp}/calls`, "");
    const r = spawnSync("sh", ["-c", sandbox(plan)], {
      encoding: "utf8",
      env: { ...env, PATH: `${bin}:${env.PATH ?? ""}`, CALLS: `${tmp}/calls`, CFG: cfg, LOG: log, ...extra },
      ...(timeout ? { timeout, killSignal: "SIGTERM" } : {}),
    });
    return { ...r, exitCode: r.status, calls: fs.readFileSync(`${tmp}/calls`, "utf8") };
  };
  const steps = (stdout: string) => [...stdout.matchAll(/^@@paso (\S+)/gm)].map((m) => m[1]);

  // --- Caddy (Rocky: corre como el usuario caddy) -------------------------------------------------
  const cdir = `${tmp}/caddy`;
  fs.mkdirSync(`${cdir}/sites`, { recursive: true });
  const caddyfile = `${cdir}/Caddyfile`;
  const sitesFile = `${cdir}/sites/main.caddy`;
  fs.writeFileSync(caddyfile, CADDYFILE);
  fs.writeFileSync(sitesFile, CADDY_SITES);
  const caddySrv: ServerInfo = { server: "caddy", source: "api", configPath: caddyfile, status: "active", sites: [], warning: null };
  const apiSite: Site = {
    key: "caddy|srv0|api.example.com",
    server: "caddy",
    names: ["api.example.com"],
    listens: [{ host: null, port: 443, https: true }],
    https: true,
    isDefault: false,
    cert: null,
    certExpires: null,
    routes: [],
    file: caddyfile,
    line: null,
  };
  const on = siteLogPlan(caddySrv, apiSite, "enable")!;
  const r1 = run(on, cdir, { PS_USER: "caddy" });
  eq(r1.status, 0, `Caddy: activa (stderr: ${r1.stderr})`);
  eq(steps(r1.stdout), ["check", "backup", "folder", "edit", "validate", "reload", "verify"], "Caddy: avisa de cada paso en orden");
  ok(fs.readFileSync(sitesFile, "utf8").includes("output file"), "Caddy: el archivo del sitio queda editado");
  eq(fs.readdirSync(backups).length, 1, "Caddy: guarda una copia antes de editar");
  ok(r1.calls.includes(`chown caddy: ${tmp}/log-caddy/api.example.com.log`), "Caddy: el registro es del usuario de Caddy antes de validar");
  ok(r1.calls.indexOf("chown caddy:") < r1.calls.lastIndexOf("caddy validate"), "Caddy: … y eso pasa antes de validar lo nuevo");
  ok(r1.calls.includes("systemctl reload caddy"), "Caddy: recarga con systemd");
  ok(readLogRun(on, "caddy", r1).summary?.includes("la visita de prueba ya aparece"), "Caddy: resumen con la visita de prueba");

  const r2 = run(on, cdir, { PS_USER: "caddy" });
  eq([r2.status, /^@@estado (\S+)/m.exec(r2.stdout)?.[1], fs.readdirSync(backups).length], [0, "already", 1], "Caddy: activar dos veces no duplica ni copia");
  ok(readLogRun(on, "caddy", r2).summary?.includes("ya estaba en la configuración"), "Caddy: dice que ya estaba");

  const off = siteLogPlan(caddySrv, apiSite, "disable")!;
  eq(run(off, cdir).status, 0, "Caddy: quitar el registro");
  eq(fs.readFileSync(sitesFile, "utf8"), CADDY_SITES, "Caddy: queda exactamente como antes");

  // La configuración nueva no valida: se restaura y se explica con la línea.
  const bad = run(on, cdir, { BAD_NEW: CADDY26_VALIDATE_ERROR });
  eq([bad.status, fs.readFileSync(sitesFile, "utf8")], [1, CADDY_SITES], "Caddy: si no valida, el archivo vuelve a estar como antes");
  const badMsg = readLogRun(on, "caddy", bad).error ?? "";
  ok(badMsg.startsWith("La configuración nueva no pasó «caddy validate»") && badMsg.includes("Línea que falló: Error: adapting config"), `Caddy: mensaje claro (${badMsg})`);

  // Caddy 2.11 no puede abrir el registro al recargar: se restaura y se dice por qué.
  const denied = run(on, cdir, { RELOAD_FAIL: CADDY_RELOAD_DENIED });
  eq([denied.status, fs.readFileSync(sitesFile, "utf8")], [1, CADDY_SITES], "Caddy: si la recarga falla, se restaura");
  const deniedMsg = readLogRun(on, "caddy", denied).error ?? "";
  ok(deniedMsg.startsWith("Caddy no aceptó la recarga") && deniedMsg.includes("Permiso denegado"), `Caddy: recarga sin permiso (${deniedMsg})`);

  // La configuración ya estaba rota: no se toca nada.
  const copies = fs.readdirSync(backups).length;
  const before = run(on, cdir, { BROKEN: CADDY26_VALIDATE_ERROR });
  eq([before.status, steps(before.stdout), fs.readdirSync(backups).length], [1, ["check"], copies], "Caddy: con un error previo para en «Revisar»");
  ok(readLogRun(on, "caddy", before).error?.startsWith("La configuración ya tenía un error antes del cambio"), "Caddy: lo dice así");

  // Cancelar durante la validación: el archivo vuelve a estar como antes.
  const canceled = run(on, cdir, { SLOW: "1" }, 1000);
  ok(canceled.status !== 0, "Caddy: cancelar corta el script");
  eq(fs.readFileSync(sitesFile, "utf8"), CADDY_SITES, "Caddy: al cancelar el archivo queda como antes");

  // --- nginx con SELinux (Rocky) ---------------------------------------------------------------
  const ndir = `${tmp}/nginx`;
  fs.mkdirSync(ndir, { recursive: true });
  const conf = `${ndir}/sites.conf`;
  fs.writeFileSync(conf, NGINX_SITES);
  const ngxSrv: ServerInfo = { server: "nginx", source: "dump", configPath: `${ndir}/nginx.conf`, status: "active", sites: [], warning: null };
  const appSite: Site = { ...apiSite, key: "nginx|app", server: "nginx", names: ["app.example.com"], listens: [{ host: null, port: 80, https: false }], https: false, file: conf, line: 1 };
  const ngOn = siteLogPlan(ngxSrv, appSite, "enable")!;
  const se = { SELINUX: "1", PS_LABEL: "system_u:system_r:httpd_t:s0 nginx", DIR_CTX: "system_u:object_r:var_log_t:s0" };
  const n1 = run(ngOn, ndir, se);
  eq(n1.status, 0, `nginx: activa (stderr: ${n1.stderr})`);
  ok(n1.calls.includes(`semanage fcontext -a -t httpd_log_t ${tmp}/log-nginx(/.*)?`), "nginx + SELinux: la carpeta pasa a httpd_log_t");
  ok(n1.stdout.includes("SELinux activo: nginx corre como httpd_t"), "nginx + SELinux: lo cuenta en la salida");
  ok(!n1.calls.includes("chown"), "nginx: no cambia dueños (nginx abre los registros como root)");
  ok(n1.calls.includes("nginx -t -c"), "nginx: valida con nginx -t");
  fs.writeFileSync(conf, NGINX_SITES);

  const n2 = run(ngOn, ndir, { ...se, DIR_CTX: "system_u:object_r:httpd_log_t:s0" });
  ok(n2.status === 0 && !n2.calls.includes("semanage"), "nginx + SELinux: con httpd_log_t no toca nada");
  fs.writeFileSync(conf, NGINX_SITES);

  // nginx no puede abrir el registro al recargar y SELinux lo denegó.
  const n3 = run(ngOn, ndir, { RELOAD_FAIL: NGINX_SELINUX_DENIED, SELINUX: "1", AVC: AVC_DENIED });
  eq([n3.status, fs.readFileSync(conf, "utf8")], [1, NGINX_SITES], "nginx: si la recarga falla, se restaura");
  const n3Msg = readLogRun(ngOn, "nginx", n3).error ?? "";
  ok(n3Msg.includes("nginx no aceptó la recarga") && n3Msg.includes("SELinux lo bloqueó") && n3Msg.includes("[emerg] open()"), `nginx: SELinux explicado (${n3Msg})`);

  const n4 = run(ngOn, ndir, { BAD_NEW: NGINX_EMERG });
  ok(readLogRun(ngOn, "nginx", n4).error?.includes('Línea que falló: nginx: [emerg] unknown directive "acess_log"'), "nginx: nginx -t con la línea");

  // Recarga «bien» pero la visita no aparece (p. ej. nginx -s reload sin poder abrir el archivo).
  const n5 = run(ngOn, ndir, { NO_WRITE: "1" });
  eq(n5.status, 0, "nginx: sin visita la tarea no falla (la configuración ya está puesta)");
  ok(readLogRun(ngOn, "nginx", n5).summary?.includes("la visita de prueba no apareció"), "nginx: avisa de que la visita no apareció");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// --- Visita de prueba ----------------------------------------------------------------------------
{
  const base: Site = {
    key: "k",
    server: "caddy",
    names: ["*.example.com", "web.example.com"],
    listens: [{ host: null, port: 443, https: true }],
    https: true,
    isDefault: false,
    cert: null,
    certExpires: null,
    routes: [],
    file: null,
    line: null,
  };
  ok(probeCommand(base).includes("--resolve 'web.example.com:443:127.0.0.1' 'https://web.example.com:443/'"), "prueba por HTTPS con SNI del dominio");
  const http = probeCommand({ ...base, listens: [{ host: "::1", port: 8080, https: false }, ...base.listens] });
  ok(http.includes("--resolve 'web.example.com:8080:[::1]' 'http://web.example.com:8080/'"), "prefiere HTTP y respeta la IP de escucha");
}

console.log(`OK (${passed} comprobaciones del script de registro de visitas)`);
