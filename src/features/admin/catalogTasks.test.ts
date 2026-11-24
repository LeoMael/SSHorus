// Pruebas de los comandos de la Biblioteca para «Solo lo marcado» (usuarios y sitios web): etiquetas de
// tarea y los scripts ejecutados de verdad con `sh`, con caddy, nginx, systemctl, sudo y gpasswd simulados.
// Ejecutar: npx rolldown src/features/admin/catalogTasks.test.ts -p node -f esm -o /tmp/ct.mjs && node /tmp/ct.mjs
import { CATALOG } from "../commands/catalog";
import { renderTemplate } from "../commands/template";
import { bindRuntime, runtime } from "./catalogScript";
import { SITE_MARK } from "./webSites";

// El proyecto no tiene @types/node: los módulos de Node se piden con getBuiltinModule y estos tipos mínimos.
type Env = Record<string, string | undefined>;
const proc = (globalThis as unknown as { process: { env: Env; getBuiltinModule(name: string): unknown } }).process;
const { spawnSync } = proc.getBuiltinModule("node:child_process") as {
  spawnSync(cmd: string, args: string[], o: { env: Env; encoding: "utf8" }): { status: number | null; stdout: string; stderr: string };
};
const { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = proc.getBuiltinModule("node:fs") as {
  chmodSync(p: string, mode: number): void;
  existsSync(p: string): boolean;
  mkdirSync(p: string): void;
  mkdtempSync(prefix: string): string;
  readFileSync(p: string, enc: "utf8"): string;
  rmSync(p: string, o: { recursive: boolean; force: boolean }): void;
  writeFileSync(p: string, data: string): void;
};
const { tmpdir, userInfo } = proc.getBuiltinModule("node:os") as { tmpdir(): string; userInfo(): { username: string } };
const { join } = proc.getBuiltinModule("node:path") as { join(...parts: string[]): string };

let passed = 0;
function ok(cond: boolean, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}

const byId = (id: string) => {
  const e = CATALOG.find((x) => x.id === id);
  if (!e) throw new Error(`falta ${id} en el catálogo`);
  return e;
};

// ── Etiquetas de tarea ──
ok(CATALOG.filter((e) => e.category === "Podman" || e.category === "Docker").every((e) => e.perm === "containers"), "contenedores");
ok(byId("usuarios.crear-usuario").perm === "users-create", "crear usuario");
ok(byId("usuarios.crear-usuario-clave").perm === "users-create", "crear usuario con clave");
ok(byId("usuarios.dar-sudo-deb").perm === "users-edit", "dar sudo");
ok(byId("usuarios.anadir-a-grupo").perm === "users-edit", "grupo");
ok(byId("usuarios.borrar-usuario").perm === "users-delete" && byId("usuarios.borrar-usuario").dangerous, "borrar");
ok(byId("usuarios.cambiar-dueno").perm === undefined, "chown -R sin tarea (necesita comandos libres)");
ok(byId("web.caddy-crear-sitio").perm === "web" && byId("web.recargar-nginx").perm === "web", "web");
ok(byId("servicios.iniciar-detener-reiniciar").perm === "services", "servicios");
ok(byId("paquetes.instalar-deb").perm === "packages", "paquetes");
ok(byId("red.abrir-puerto-rpm").perm === "firewall" && byId("red.ip-publica").perm === undefined, "cortafuegos");
ok(byId("git.traer-cambios").perm === undefined, "git sin tarea");
const ids = new Set(CATALOG.map((e) => e.id));
ok(ids.size === CATALOG.length, "ids sin repetir");

// ── Marcas ──
ok(bindRuntime(`echo ${"'" + runtime("1") + "'"} ${"'" + runtime("cf") + "'"}`) === 'echo "$1" "$cf"', "bindRuntime");
let threw = false;
try {
  bindRuntime(`echo 'hola ${runtime("1")}'`);
} catch {
  threw = true;
}
ok(threw, "una marca dentro de otro texto es un error");
ok(CATALOG.every((e) => !e.command.includes("\u0001")), "sin marcas en el catálogo");

// ── Ejecución con herramientas simuladas ──
const dir = mkdtempSync(join(tmpdir(), "sshorus-catalog-"));
const bin = join(dir, "bin");
mkdirSync(bin);
mkdirSync(join(dir, "nginx"));
const tool = (name: string, body: string) => {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
};
tool("sudo", 'exec "$@"');
tool(
  "systemctl",
  `case "$1" in
  cat) [ "$2" = caddy ] && echo "ExecStart=/usr/bin/caddy run --config $TV_DIR/Caddyfile";;
  is-active) echo active;;
  reload) echo "reload $2" >> "$TV_DIR/log";;
esac`,
);
// La configuración «no vale» si algún sitio apunta al puerto 666.
tool("caddy", `if [ "$1" = validate ]; then if grep -rqs ':666$' "$TV_DIR/sites"; then echo 'config no válida' >&2; exit 1; fi; fi`);
tool(
  "nginx",
  `case "$1" in
  -V) echo "configure arguments: --conf-path=$TV_DIR/nginx/nginx.conf" >&2;;
  -t) if grep -rqs ':666;' "$TV_DIR/nginx/conf.d"; then exit 1; fi;;
esac`,
);
tool("usermod", 'echo "usermod $*" >> "$TV_DIR/log"');
tool("gpasswd", 'echo "gpasswd $*" >> "$TV_DIR/log"');
tool("userdel", 'echo "userdel $*" >> "$TV_DIR/log"');
const caddyfile = join(dir, "Caddyfile");
writeFileSync(caddyfile, "{\n\temail yo@ejemplo.com\n}\n");
writeFileSync(join(dir, "nginx", "nginx.conf"), `http {\n    include ${dir}/nginx/conf.d/*.conf;\n}\n`);
const me = userInfo().username;

function run(id: string, values: Record<string, string>, env: Record<string, string> = {}) {
  const cmd = renderTemplate(byId(id).command, values, { fillMissing: true });
  const r = spawnSync("sh", ["-c", cmd], {
    env: { ...proc.env, PATH: `${bin}:${proc.env.PATH}`, TV_DIR: dir, SUDO_USER: "", ...env },
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const site = join(dir, "sites", "app.ejemplo.com.caddy");
const log = () => read(join(dir, "log")) ?? "";

try {
  // Caddy: crear
  let r = run("web.caddy-crear-sitio", { dominio: "app.ejemplo.com", puerto: "8080" });
  ok(r.code === 0, `crear: ${r.err}`);
  ok(read(site) === `${SITE_MARK}\napp.ejemplo.com {\n\treverse_proxy 127.0.0.1:8080\n}\n`, `archivo del sitio: ${read(site)}`);
  ok((read(caddyfile) ?? "").split("\n").filter((l: string) => l === `import ${dir}/sites/*.caddy`).length === 1, "import añadido una vez");
  ok(log().includes("reload caddy"), "recargado");
  r = run("web.caddy-crear-sitio", { dominio: "app.ejemplo.com", puerto: "8081" });
  ok(r.code !== 0 && r.err.includes("ya existe"), `crear dos veces: ${r.err}`);

  // Validación fallida: se deja como estaba
  const before = read(caddyfile);
  r = run("web.caddy-editar-sitio", { dominio: "app.ejemplo.com", puerto: "666" });
  ok(r.code !== 0 && r.err.includes("se dejó como estaba"), `editar con fallo: ${r.err}`);
  ok((read(site) ?? "").includes(":8080"), "el sitio sigue igual");
  r = run("web.caddy-crear-sitio", { dominio: "malo.ejemplo.com", puerto: "666" });
  ok(r.code !== 0 && read(join(dir, "sites", "malo.ejemplo.com.caddy")) === null, "el sitio nuevo malo se quita");
  ok(read(caddyfile) === before, "Caddyfile igual");

  // Editar y borrar
  r = run("web.caddy-editar-sitio", { dominio: "app.ejemplo.com", puerto: "9090" });
  ok(r.code === 0 && (read(site) ?? "").includes("127.0.0.1:9090"), `editar: ${r.err}`);
  writeFileSync(join(dir, "sites", "mio.caddy"), "mio {\n}\n");
  r = run("web.caddy-borrar-sitio", { dominio: "mio" });
  ok(r.code !== 0 && existsSync(join(dir, "sites", "mio.caddy")), "no borra lo que no creó SSHorus");
  r = run("web.caddy-borrar-sitio", { dominio: "app.ejemplo.com" });
  ok(r.code === 0 && !existsSync(site), `borrar: ${r.err}`);
  ok(run("web.caddy-probar", {}).code === 0, "probar caddy");

  // Valores que intentan ampliar el comando
  for (const [dominio, puerto] of [
    ["x;touch pwned", "80"],
    ["a b", "80"],
    ["../../etc/passwd", "80"],
    ["ok.com", "80; touch pwned"],
    ["ok.com", "70000"],
  ]) {
    r = run("web.caddy-crear-sitio", { dominio, puerto });
    ok(r.code === 2, `«${dominio}» «${puerto}» rechazado: ${r.code} ${r.err}`);
  }
  ok(!existsSync("pwned") && !existsSync(join(dir, "pwned")), "sin inyección");

  // nginx
  r = run("web.nginx-crear-sitio", { dominio: "api.ejemplo.com", puerto: "3000" });
  const ngx = read(join(dir, "nginx", "conf.d", "api.ejemplo.com.conf")) ?? "";
  ok(r.code === 0 && ngx.startsWith(SITE_MARK) && ngx.includes("server_name api.ejemplo.com;"), `nginx: ${r.err}`);
  ok(ngx.includes("proxy_pass http://127.0.0.1:3000;") && ngx.includes("proxy_set_header Host $host;"), ngx);
  ok(log().includes("reload nginx"), "nginx recargado");
  r = run("web.nginx-editar-sitio", { dominio: "api.ejemplo.com", puerto: "666" });
  ok(r.code !== 0 && (read(join(dir, "nginx", "conf.d", "api.ejemplo.com.conf")) ?? "").includes(":3000;"), "nginx deshace");

  // Usuarios
  r = run("usuarios.anadir-a-grupo", { usuario: me, grupo: "root" });
  ok(r.code === 0 && log().includes(`gpasswd -a ${me} root`), `grupo: ${r.err}`);
  r = run("usuarios.cambiar-shell", { usuario: me, nuevo_shell: "/bin/sh" });
  ok(r.code === 0 && log().includes(`usermod -s /bin/sh ${me}`), `shell: ${r.err}`);
  r = run("usuarios.bloquear-usuario", { usuario: me });
  ok(r.code === 0 && log().includes(`usermod -L ${me}`), `bloquear: ${r.err}`);
  ok(run("usuarios.anadir-a-grupo", { usuario: "Ana;id", grupo: "root" }).code === 2, "nombre no válido");
  ok(run("usuarios.anadir-a-grupo", { usuario: me, grupo: "no-existe-grupo" }).code === 1, "grupo inexistente");
  ok(run("usuarios.borrar-usuario", { usuario: "root" }).code === 2, "root nunca");
  ok(run("usuarios.borrar-usuario", { usuario: me }, { SUDO_USER: me }).code === 2, "el usuario conectado nunca");
  r = run("usuarios.borrar-usuario-y-carpeta", { usuario: me });
  ok(r.code === 0 && log().includes(`userdel -r ${me}`), `borrar: ${r.err}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`catalogTasks: ${passed} comprobaciones correctas`);
