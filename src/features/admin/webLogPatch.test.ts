// Pruebas del parche en Python que pone o quita el registro de visitas en Caddy y nginx, con
// configuraciones reales (snippets, import, opciones globales, varios server, location con
// «access_log off;»). Ejecutar: npm test -- webLogPatch
import { CADDY_SITES, CADDYFILE, NGINX_CONF, NGINX_CONF_SERVER_LINE, NGINX_SITES } from "./webLogFixtures";
import { PY_LOG_PATCH } from "./webLogPatch";
import { TRAFFIC_LOG_MARK } from "./webTrafficSetup";

const CHILD = "node:child_process";
const { spawnSync } = (await import(/* @vite-ignore */ CHILD)) as {
  spawnSync: (cmd: string, args: string[], opts: { encoding: "utf8" }) => { status: number | null; stdout: string; stderr: string };
};
const FS = "node:fs";
const fs = (await import(/* @vite-ignore */ FS)) as {
  mkdtempSync: (prefix: string) => string;
  mkdirSync: (p: string, o?: { recursive: boolean }) => void;
  writeFileSync: (p: string, s: string) => void;
  readFileSync: (p: string, enc: "utf8") => string;
  existsSync: (p: string) => boolean;
  rmSync: (p: string, o: { recursive: boolean; force: boolean }) => void;
};

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}

const tmp = fs.mkdtempSync("/tmp/sshorus-wlp-");
try {
  const py = `${tmp}/patch.py`;
  fs.writeFileSync(py, PY_LOG_PATCH);
  const out = `${tmp}/new`;
  const patch = (action: string, kind: string, where: string, target: string, log: string) => {
    fs.rmSync(out, { recursive: false, force: true });
    const r = spawnSync("python3", [py, action, kind, where, target, log, TRAFFIC_LOG_MARK, out], { encoding: "utf8" });
    const file = /^file=(.*)$/m.exec(r.stdout)?.[1] ?? null;
    const state = /^state=(.*)$/m.exec(r.stdout)?.[1] ?? null;
    return { status: r.status, file, state, stderr: r.stderr, text: fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null };
  };

  // --- Caddy ---------------------------------------------------------------------------------
  fs.mkdirSync(`${tmp}/caddy/sites`, { recursive: true });
  const main = `${tmp}/caddy/Caddyfile`;
  const sites = `${tmp}/caddy/sites/main.caddy`;
  fs.writeFileSync(main, CADDYFILE);
  fs.writeFileSync(sites, CADDY_SITES);

  const ex = patch("enable", "caddy", main, "www.example.com", "/var/log/caddy/www.example.com.log");
  eq([ex.status, ex.state, ex.file], [0, "changed", main], "Caddy: encuentra el sitio por su segundo dominio");
  const exLines = (ex.text ?? "").split("\n");
  const head = exLines.indexOf("example.com, www.example.com {");
  eq(exLines[head + 1], `\t${TRAFFIC_LOG_MARK}`, "Caddy: la marca va justo tras la cabecera del sitio");
  eq(exLines[head + 2], "\tlog {", "Caddy: el bloque log va dentro del sitio");
  ok(exLines.includes("\t\toutput file /var/log/caddy/www.example.com.log {"), "Caddy: escribe en el archivo propuesto");
  ok((ex.text ?? "").includes("\t\tlevel INFO") && (ex.text ?? "").includes("(common) {\n\tencode"), "Caddy: no toca el log global ni el snippet");

  // Sitio en un archivo importado con «log { format console }» (al diario): se sustituye y se recuerda.
  const api = patch("enable", "caddy", main, "api.example.com", "/var/log/caddy/api.example.com.log");
  eq([api.state, api.file], ["changed", sites], "Caddy: sigue el import hasta el archivo del sitio");
  ok((api.text ?? "").includes(`\t${TRAFFIC_LOG_MARK} antes: \tlog {\n\t${TRAFFIC_LOG_MARK} antes: \t\tformat console\n`), "Caddy: el log anterior queda comentado");
  ok(!/^\tlog \{\n\t\tformat console/m.test(api.text ?? ""), "Caddy: el log al diario ya no está activo");
  ok((api.text ?? "").includes("\thandle @static {\n\t\tfile_server\n\t}"), "Caddy: no toca los bloques anidados");
  fs.writeFileSync(sites, api.text ?? "");
  eq(patch("enable", "caddy", main, "api.example.com", "/var/log/caddy/api.example.com.log").state, "already", "Caddy: activar dos veces no duplica");
  const apiOff = patch("disable", "caddy", main, "api.example.com", "/var/log/caddy/api.example.com.log");
  eq(apiOff.text, CADDY_SITES, "Caddy: quitar devuelve el archivo exactamente como estaba");
  fs.writeFileSync(sites, CADDY_SITES);

  // «log» suelto (sin bloque) también se sustituye; uno que ya escribe en archivo se deja.
  const b = patch("enable", "caddy", main, "b.example.com", "/var/log/caddy/b.example.com.log");
  ok((b.text ?? "").includes(`\t${TRAFFIC_LOG_MARK} antes: \tlog\n\tlog {`), "Caddy: «log» suelto queda comentado");
  const shop = patch("enable", "caddy", main, "shop.example.com", "/var/log/caddy/shop.example.com.log");
  ok((shop.text ?? "").includes("output file /var/log/caddy/shop.log") && (shop.text ?? "").includes("shop.example.com.log"), "Caddy: con «https://…:8443» y log a archivo, se añade el propio");

  const miss = patch("enable", "caddy", main, "otro.example.com", "/var/log/caddy/otro.log");
  ok(miss.status === 2 && miss.stderr.includes("No se encontró el bloque de «otro.example.com»"), "Caddy: dominio que no está, mensaje claro");
  const json = patch("enable", "caddy", `${tmp}/caddy/caddy.json`, "x.test", "/var/log/caddy/x.log");
  ok(json.status === 2 && json.stderr.includes("configuración JSON"), "Caddy: con config JSON avisa en vez de romperla");
  eq(patch("disable", "caddy", main, "example.com", "/x.log").state, "absent", "Caddy: quitar sin registro de SSHorus no cambia nada");

  // --- nginx ---------------------------------------------------------------------------------
  const conf = `${tmp}/sites.conf`;
  fs.writeFileSync(conf, NGINX_SITES);
  const app = patch("enable", "nginx", conf, "1", "/var/log/nginx/app.example.com.access.log");
  eq(app.state, "changed", "nginx: cambia el server de la línea 1");
  ok((app.text ?? "").includes("    location ~* \\.(css|js)$ {\n        access_log off;"), "nginx: el «access_log off;» del location no se toca");
  ok(
    (app.text ?? "").includes(`        expires 7d;\n    }\n    ${TRAFFIC_LOG_MARK}\n    access_log /var/log/nginx/app.example.com.access.log combined;\n}\n\nserver { listen 80;`),
    "nginx: el registro va al final del server (no dentro del location ni del siguiente server)",
  );

  const apiN = patch("enable", "nginx", conf, "11", "/var/log/nginx/api.example.com.access.log");
  ok((apiN.text ?? "").includes(`    ${TRAFFIC_LOG_MARK} antes:     access_log off;\n    access_log /var/log/nginx/api.example.com.access.log combined;`), "nginx: «access_log off;» del server queda comentado");
  ok(!/^ {4}access_log off;/m.test((apiN.text ?? "").split("server { listen 80;")[1] ?? ""), "nginx: ya no queda el off activo en ese server");
  fs.writeFileSync(conf, apiN.text ?? "");
  eq(patch("enable", "nginx", conf, "11", "/x.log").state, "already", "nginx: activar dos veces no duplica");
  eq(patch("disable", "nginx", conf, "11", "/x.log").text, NGINX_SITES, "nginx: quitar devuelve el archivo como estaba");

  fs.writeFileSync(conf, NGINX_SITES);
  const notServer = patch("enable", "nginx", conf, "3", "/x.log");
  ok(notServer.status === 2 && notServer.stderr.includes("ya no es un «server {»"), "nginx: si la línea cambió, lo dice");
  const oneLine = patch("enable", "nginx", conf, "19", "/x.log");
  ok(oneLine.status === 2 && oneLine.stderr.includes("una sola línea"), "nginx: server en una línea, lo dice en vez de romperlo");

  // El server dentro de http justo después de un include: el registro va en el server, no en http.
  const ngConf = `${tmp}/nginx.conf`;
  fs.writeFileSync(ngConf, NGINX_CONF);
  const def = patch("enable", "nginx", ngConf, String(NGINX_CONF_SERVER_LINE), "/var/log/nginx/nginx-default.access.log");
  ok((def.text ?? "").includes(`        root         /usr/share/nginx/html;\n        ${TRAFFIC_LOG_MARK}\n        access_log /var/log/nginx/nginx-default.access.log combined;\n    }\n}`), "nginx: el server de nginx.conf, no el bloque http");

  // Formato de la versión anterior (marca al final de la línea): también se quita.
  fs.writeFileSync(conf, `server {\n    access_log /var/log/nginx/viejo.access.log combined; ${TRAFFIC_LOG_MARK}\n    listen 80;\n}\n`);
  eq(patch("disable", "nginx", conf, "1", "/x.log").text, "server {\n    listen 80;\n}\n", "nginx: quita también el formato anterior");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`OK (${passed} comprobaciones del parche de registros)`);
