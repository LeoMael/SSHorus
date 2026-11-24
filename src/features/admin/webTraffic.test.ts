// Pruebas del monitor de tráfico web: detección de logs (nginx/Caddy), análisis real (Python 3),
// y planes de activación con copia de respaldo y restauración automática.
// Ejecutar: npx rolldown src/features/admin/webTraffic.test.ts -p node -f esm -o /tmp/wt.mjs && node /tmp/wt.mjs
import { parseWeb, type ServerInfo, type Site } from "./web";
import { detectCaddyAccessLogs, detectNginxAccessLogs } from "./webTrafficLog";
import { parseTraffic, trafficScript } from "./webTraffic";
import { enableSiteLogPlan, siteLogSlug, suggestedLogPath, TRAFFIC_LOG_MARK } from "./webTrafficSetup";

// Sin @types/node en el proyecto: carga dinámica mínima para ejecutar `sh` en pruebas.
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
  mkdirSync: (p: string, o?: { recursive: boolean }) => void;
  writeFileSync: (p: string, s: string, o?: { mode?: number }) => void;
  readFileSync: (p: string, enc: "utf8") => string;
  rmSync: (p: string, o: { recursive: boolean; force: boolean }) => void;
};
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  }
  passed++;
}
function ok(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}

// ---------------------------------------------------------------------------------------------
// 1. Detección de access_log en nginx
// ---------------------------------------------------------------------------------------------
{
  const dir = (name: string, args: string[], file: string, line: number) => ({ name, args, block: null, file, line });
  const http = [dir("access_log", ["/var/log/nginx/global.log", "combined"], "/etc/nginx/nginx.conf", 10)];
  const sOwn = [dir("access_log", ["/var/log/nginx/app.log", "combined"], "/etc/nginx/conf.d/app.conf", 3)];
  const sOff = [dir("access_log", ["off"], "/etc/nginx/conf.d/off.conf", 3)];
  const sInherit = [dir("server_name", ["inherit.test"], "/etc/nginx/conf.d/in.conf", 2)];
  const sShared1 = [dir("access_log", ["/var/log/nginx/shared.log"], "/etc/nginx/conf.d/a.conf", 3)];
  const sShared2 = [dir("access_log", ["/var/log/nginx/shared.log"], "/etc/nginx/conf.d/b.conf", 3)];
  const sSyslog = [dir("access_log", ["syslog:server=127.0.0.1"], "/etc/nginx/conf.d/sys.conf", 3)];

  const res = detectNginxAccessLogs(http, [sOwn, sOff, sInherit, sShared1, sShared2, sSyslog]);
  eq(res[0], { path: "/var/log/nginx/app.log", format: "combined", shared: false }, "nginx log propio");
  eq(res[1], { path: null, format: "off", shared: false }, "nginx access_log off");
  eq(res[2], { path: "/var/log/nginx/global.log", format: "combined", shared: true }, "nginx hereda de http");
  eq(res[3], { path: "/var/log/nginx/shared.log", format: "combined", shared: true }, "nginx compartido 1");
  eq(res[4], { path: "/var/log/nginx/shared.log", format: "combined", shared: true }, "nginx compartido 2");
  eq(res[5], { path: null, format: "off", shared: false }, "nginx syslog no legible como archivo");

  // Sin access_log en http ni server -> defecto de nginx (compartido)
  const def = detectNginxAccessLogs([], [sInherit]);
  eq(def[0], { path: "/var/log/nginx/access.log", format: "combined", shared: true }, "nginx por defecto");
}

// ---------------------------------------------------------------------------------------------
// 2. Detección de access log en Caddy (JSON de API / caddy adapt)
// ---------------------------------------------------------------------------------------------
{
  const makeCaddySite = (key: string, names: string[]): Site => ({
    key,
    server: "caddy",
    names,
    listens: [{ host: null, port: 443, https: true }],
    isDefault: false,
    https: true,
    cert: null,
    certExpires: null,
    routes: [],
    file: "/etc/caddy/Caddyfile",
    line: null,
  });

  const sites: Site[] = [
    makeCaddySite("caddy|srv0|app.test", ["app.test"]),
    makeCaddySite("caddy|srv0|shared1.test", ["shared1.test"]),
    makeCaddySite("caddy|srv0|shared2.test", ["shared2.test"]),
    makeCaddySite("caddy|srv0|journal.test", ["journal.test"]),
    makeCaddySite("caddy|srv0|skipped.test", ["skipped.test"]),
    makeCaddySite("caddy|srv1|nolog.test", ["nolog.test"]),
  ];

  const cfg = {
    logging: {
      logs: {
        log_app: { writer: { output: "file", filename: "/var/log/caddy/app.log" } },
        log_shared: { writer: { output: "file", filename: "/var/log/caddy/shared.log" } },
        log_journal: { writer: { output: "stdout" } },
      },
    },
    apps: {
      http: {
        servers: {
          srv0: {
            logs: {
              logger_names: {
                "app.test": "log_app",
                "shared1.test": "log_shared",
                "shared2.test": ["log_shared"],
                "journal.test": "log_journal",
              },
              skip_hosts: ["skipped.test"],
              skip_unmapped_hosts: true,
            },
          },
          srv1: {},
        },
      },
    },
  };

  const map = detectCaddyAccessLogs(cfg, sites);
  eq(map.get("caddy|srv0|app.test"), { path: "/var/log/caddy/app.log", format: "json", shared: false }, "caddy log propio");
  eq(map.get("caddy|srv0|shared1.test"), { path: "/var/log/caddy/shared.log", format: "json", shared: true }, "caddy compartido 1");
  eq(map.get("caddy|srv0|shared2.test"), { path: "/var/log/caddy/shared.log", format: "json", shared: true }, "caddy compartido 2");
  eq(map.get("caddy|srv0|journal.test"), { path: null, format: "journal", shared: false }, "caddy stdout -> journal");
  eq(map.get("caddy|srv0|skipped.test"), { path: null, format: "off", shared: false }, "caddy skip_hosts -> off");
  eq(map.get("caddy|srv1|nolog.test"), { path: null, format: "off", shared: false }, "caddy sin bloque logs -> off");

  // Comprobación integrada con parseWeb (nginx + Caddy)
  const webOut = [
    "@@svc",
    "caddy active",
    "@@caddy",
    "caddy api /etc/caddy/Caddyfile",
    "@@caddyjson",
    JSON.stringify({
      logging: { logs: { log0: { writer: { output: "file", filename: "/var/log/caddy/demo.log" } } } },
      apps: {
        http: {
          servers: {
            srv0: {
              listen: [":443"],
              logs: { logger_names: { "demo.test": "log0" } },
              routes: [{ match: [{ host: ["demo.test"] }], handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "127.0.0.1:8080" }] }] }],
            },
          },
        },
      },
    }),
    "@@end",
  ].join("\n");
  const parsed = parseWeb(webOut);
  eq(parsed.servers[0]?.sites[0]?.accessLog, { path: "/var/log/caddy/demo.log", format: "json", shared: false }, "parseWeb rellena accessLog en Caddy");
}

// ---------------------------------------------------------------------------------------------
// 3. Slug, ruta propuesta y planes de activación
// ---------------------------------------------------------------------------------------------
{
  eq(siteLogSlug({ names: ["*.Mi-App.Example.COM"], server: "caddy", key: "k" }), "wildcard-mi-app.example.com", "slug wildcard");
  eq(suggestedLogPath({ names: ["api.ejemplo.com"], server: "caddy", key: "k" }), "/var/log/caddy/api.ejemplo.com.log", "ruta caddy");
  eq(suggestedLogPath({ names: ["api.ejemplo.com"], server: "nginx", key: "k" }), "/var/log/nginx/api.ejemplo.com.access.log", "ruta nginx");

  const caddySrv: ServerInfo = { server: "caddy", source: "api", configPath: "/etc/caddy/Caddyfile", status: "active", sites: [], warning: null };
  const noNameSite: Site = {
    key: "caddy|srv0|*",
    server: "caddy",
    names: [],
    listens: [],
    isDefault: true,
    https: false,
    cert: null,
    certExpires: null,
    routes: [],
    file: "/etc/caddy/Caddyfile",
    line: null,
  };
  eq(enableSiteLogPlan(caddySrv, noNameSite), null, "caddy sin dominio devuelve null");

  const nginxSrv: ServerInfo = { server: "nginx", source: "dump", configPath: "/etc/nginx/nginx.conf", status: "active", sites: [], warning: null };
  const noFileNginx: Site = { ...noNameSite, server: "nginx", names: ["x.test"], file: null, line: null };
  eq(enableSiteLogPlan(nginxSrv, noFileNginx), null, "nginx sin archivo devuelve null");
}

// ---------------------------------------------------------------------------------------------
// 4. Ejecución real del analizador (Caddy JSON, nginx combined y archivo ausente)
// ---------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync("/tmp/sshorus-wt-");
try {
  const now = Math.floor(Date.now() / 1000);
  const caddyLog = `${tmp}/caddy.log`;
  const caddyLines = [
    // Petición normal al dominio objetivo (200, con referer externo)
    JSON.stringify({
      ts: now - 120,
      status: 200,
      size: 2048,
      request: {
        host: "app.test:443",
        client_ip: "203.0.113.10",
        method: "GET",
        uri: "/panel?tab=1",
        headers: { "User-Agent": ["Mozilla/5.0"], Referer: ["https://google.com/search?q=x"] },
      },
    }),
    // Error 502 al dominio objetivo (con referer interno que no debe contarse como origen externo)
    JSON.stringify({
      ts: now - 60,
      status: 502,
      size: 512,
      request: {
        host: "app.test",
        remote_ip: "203.0.113.11",
        method: "POST",
        uri: "/api/save",
        headers: { "User-Agent": ["Mozilla/5.0"], Referer: ["https://app.test/panel"] },
      },
    }),
    // Estático .js (debe filtrarse con excludeStatic=true)
    JSON.stringify({
      ts: now - 50,
      status: 200,
      size: 9000,
      request: { host: "app.test", client_ip: "203.0.113.10", method: "GET", uri: "/assets/app.js", headers: { "User-Agent": ["Mozilla/5.0"] } },
    }),
    // Bot (debe filtrarse con excludeBots=true)
    JSON.stringify({
      ts: now - 40,
      status: 200,
      size: 1000,
      request: { host: "app.test", client_ip: "198.51.100.5", method: "GET", uri: "/", headers: { "User-Agent": ["Googlebot/2.1"] } },
    }),
    // Otro dominio en log compartido (debe excluirse por filtro de host)
    JSON.stringify({
      ts: now - 30,
      status: 200,
      size: 3000,
      request: { host: "otro.test", client_ip: "198.51.100.9", method: "GET", uri: "/privado", headers: { "User-Agent": ["Mozilla/5.0"] } },
    }),
    // Antigua (> 24 h, debe excluirse en 24h)
    JSON.stringify({
      ts: now - 90000,
      status: 200,
      size: 100,
      request: { host: "app.test", client_ip: "203.0.113.99", method: "GET", uri: "/viejo", headers: { "User-Agent": ["Mozilla/5.0"] } },
    }),
  ];
  fs.writeFileSync(caddyLog, caddyLines.join("\n") + "\n");

  const caddySite: Site = {
    key: "caddy|srv0|app.test",
    server: "caddy",
    names: ["app.test"],
    listens: [],
    isDefault: false,
    https: true,
    cert: null,
    certExpires: null,
    routes: [],
    file: "/etc/caddy/Caddyfile",
    line: null,
    accessLog: { path: caddyLog, format: "json", shared: true },
  };

  const runSh = (script: string, extraPath?: string) => {
    const r = spawnSync("sh", ["-c", script], {
      encoding: "utf8",
      env: extraPath ? { ...env, PATH: `${extraPath}:${env.PATH ?? ""}` } : env,
    });
    return r;
  };

  const r1 = runSh(trafficScript(caddySite, { range: "24h", excludeStatic: true, excludeBots: true }));
  eq(r1.status, 0, `caddy analyzer exit (stderr: ${r1.stderr})`);
  const rep1 = parseTraffic(r1.stdout, true);
  eq(rep1.totalRequests, 2, "caddy totalRequests filtrando estáticos, bots, otro host y >24h");
  eq(rep1.uniqueIps, 2, "caddy uniqueIps");
  eq(rep1.totalBytes, 2560, "caddy totalBytes");
  eq(rep1.staticSkipped, 1, "caddy staticSkipped");
  eq(rep1.botSkipped, 1, "caddy botSkipped");
  eq(rep1.status, { s2xx: 1, s3xx: 0, s4xx: 0, s5xx: 1 }, "caddy status");
  eq(rep1.buckets.length, 24, "caddy 24 buckets en 24h");
  eq(rep1.topReferrers, [{ host: "google.com", count: 1 }], "caddy referer externo (excluye propio)");
  eq(rep1.recent[0]?.path, "/api/save", "caddy recent más reciente primero");
  eq(rep1.meta.hostFiltered, true, "caddy hostFiltered");
  eq(rep1.meta.sharedLog, true, "caddy sharedLog");

  const r1All = runSh(trafficScript(caddySite, { range: "24h", excludeStatic: false, excludeBots: false }));
  const rep1All = parseTraffic(r1All.stdout, true);
  eq(rep1All.totalRequests, 4, "caddy sin filtros incluye estáticos y bots (sigue excluyendo otro host y >24h)");

  // nginx combined
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtNgx = (tsSec: number) => {
    const d = new Date(tsSec * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getUTCDate())}/${months[d.getUTCMonth()]}/${d.getUTCFullYear()}:${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
  };
  const ngxLog = `${tmp}/nginx.log`;
  fs.writeFileSync(
    ngxLog,
    [
      `192.0.2.1 - - [${fmtNgx(now - 90)}] "GET /inicio HTTP/2.0" 200 1200 "https://duckduckgo.com/" "Mozilla/5.0"`,
      `192.0.2.2 - - [${fmtNgx(now - 45)}] "GET /noexiste HTTP/1.1" 404 300 "-" "Mozilla/5.0"`,
      `192.0.2.1 - - [${fmtNgx(now - 30)}] "GET /logo.png HTTP/2.0" 200 8000 "-" "Mozilla/5.0"`,
      `192.0.2.3 - - [${fmtNgx(now - 20)}] "GET /health HTTP/1.1" 200 10 "-" "curl/8.5.0"`,
    ].join("\n") + "\n",
  );
  const ngxSite: Site = {
    ...caddySite,
    key: "nginx|1",
    server: "nginx",
    accessLog: { path: ngxLog, format: "combined", shared: true },
  };
  const r2 = runSh(trafficScript(ngxSite, { range: "7d", excludeStatic: true, excludeBots: true }));
  eq(r2.status, 0, `nginx analyzer exit (stderr: ${r2.stderr})`);
  const rep2 = parseTraffic(r2.stdout, true);
  eq(rep2.totalRequests, 2, "nginx totalRequests");
  eq(rep2.uniqueIps, 2, "nginx uniqueIps");
  eq(rep2.status, { s2xx: 1, s3xx: 0, s4xx: 1, s5xx: 0 }, "nginx status");
  eq(rep2.staticSkipped, 1, "nginx staticSkipped");
  eq(rep2.botSkipped, 1, "nginx botSkipped");
  eq(rep2.buckets.length, 7, "nginx 7 buckets en 7d");
  eq(rep2.meta.hostFiltered, false, "nginx combined no trae host");
  eq(rep2.topReferrers, [{ host: "duckduckgo.com", count: 1 }], "nginx referer");

  // Archivo inexistente
  const missingSite: Site = { ...caddySite, accessLog: { path: `${tmp}/no-existe.log`, format: "json", shared: false } };
  const rMiss = runSh(trafficScript(missingSite, { range: "24h", excludeStatic: true, excludeBots: true }));
  const repMiss = parseTraffic(rMiss.stdout, false);
  eq(repMiss.totalRequests, 0, "archivo ausente -> 0 peticiones");
  ok(repMiss.meta.note && repMiss.meta.note.includes("aún no existe"), "archivo ausente informa en meta.note");

  // ---------------------------------------------------------------------------------------------
  // 5. Parcheo real de Caddyfile (con import) y nginx + rollback ante fallo de validación
  // ---------------------------------------------------------------------------------------------
  const binOk = `${tmp}/bin-ok`;
  const binFail = `${tmp}/bin-fail`;
  fs.mkdirSync(binOk, { recursive: true });
  fs.mkdirSync(binFail, { recursive: true });
  fs.writeFileSync(`${binOk}/caddy`, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(`${binOk}/nginx`, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(`${binOk}/systemctl`, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(`${binFail}/caddy`, "#!/bin/sh\necho bad config >&2\nexit 1\n", { mode: 0o755 });
  fs.writeFileSync(`${binFail}/nginx`, "#!/bin/sh\necho bad nginx >&2\nexit 1\n", { mode: 0o755 });
  fs.writeFileSync(`${binFail}/systemctl`, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  // 5a. Caddy con archivo importado
  const caddyDir = `${tmp}/etc-caddy`;
  fs.mkdirSync(`${caddyDir}/sites`, { recursive: true });
  const mainCaddy = `${caddyDir}/Caddyfile`;
  const subCaddy = `${caddyDir}/sites/app.caddy`;
  fs.writeFileSync(mainCaddy, "import sites/*.caddy\n");
  const origCaddy = "app.test {\n    reverse_proxy 127.0.0.1:3000\n}\n";
  fs.writeFileSync(subCaddy, origCaddy);

  const caddySrv: ServerInfo = { server: "caddy", source: "api", configPath: mainCaddy, status: "active", sites: [], warning: null };
  const caddyPlan = enableSiteLogPlan(caddySrv, { ...caddySite, file: mainCaddy });
  ok(caddyPlan !== null, "enableSiteLogPlan genera plan para Caddy");

  // Redirigimos /var/log/caddy a un directorio temporal para correr sin root
  const sandboxPlan = (steps: string[]) =>
    [
      "set -e",
      ...steps.map((s) =>
        s
          .replace(/\/var\/log\/caddy/g, `${tmp}/log-caddy`)
          .replace(/\/var\/log\/nginx/g, `${tmp}/log-nginx`)
          .replace(/chown caddy:caddy [^&]+ && /g, ""),
      ),
    ].join("\n");

  // Primero probamos rollback cuando `caddy validate` falla
  const rCaddyFail = runSh(sandboxPlan(caddyPlan!.plan.steps), binFail);
  ok(rCaddyFail.status !== 0, "plan Caddy falla si caddy validate falla");
  eq(fs.readFileSync(subCaddy, "utf8"), origCaddy, "plan Caddy restaura el archivo original si falla");

  // Ahora con validación correcta
  const rCaddyOk = runSh(sandboxPlan(caddyPlan!.plan.steps), binOk);
  eq(rCaddyOk.status, 0, `plan Caddy aplica bien (stderr: ${rCaddyOk.stderr})`);
  const patchedCaddy = fs.readFileSync(subCaddy, "utf8");
  ok(patchedCaddy.includes(TRAFFIC_LOG_MARK), "Caddyfile incluye marca de SSHorus");
  ok(patchedCaddy.includes("roll_size 10mb") && patchedCaddy.includes("format json"), "Caddyfile incluye rotación y format json");

  // Re-ejecutar cuando ya hay `log` debe rechazar sin duplicar
  const rCaddyDup = runSh(sandboxPlan(caddyPlan!.plan.steps), binOk);
  ok(rCaddyDup.status !== 0, "plan Caddy no duplica un bloque log ya existente");
  eq(fs.readFileSync(subCaddy, "utf8"), patchedCaddy, "archivo Caddy sin cambios tras rechazo por duplicado");

  // 5b. nginx sustituyendo `access_log off;` y probando rollback
  const ngxFile = `${tmp}/site.conf`;
  const origNgx = "server {\n    listen 80;\n    server_name api.test;\n    access_log off;\n    location / { proxy_pass http://127.0.0.1:4000; }\n}\n";
  fs.writeFileSync(ngxFile, origNgx);
  const ngxSrv: ServerInfo = { server: "nginx", source: "dump", configPath: ngxFile, status: "active", sites: [], warning: null };
  const ngxTarget: Site = { ...ngxSite, names: ["api.test"], file: ngxFile, line: 1 };
  const ngxPlan = enableSiteLogPlan(ngxSrv, ngxTarget);
  ok(ngxPlan !== null, "enableSiteLogPlan genera plan para nginx");

  const rNgxFail = runSh(sandboxPlan(ngxPlan!.plan.steps), binFail);
  ok(rNgxFail.status !== 0, "plan nginx falla si nginx -t falla");
  eq(fs.readFileSync(ngxFile, "utf8"), origNgx, "plan nginx restaura el archivo original si falla");

  const rNgxOk = runSh(sandboxPlan(ngxPlan!.plan.steps), binOk);
  eq(rNgxOk.status, 0, `plan nginx aplica bien (stderr: ${rNgxOk.stderr})`);
  const patchedNgx = fs.readFileSync(ngxFile, "utf8");
  ok(!patchedNgx.includes("access_log off;"), "plan nginx sustituye access_log off;");
  ok(patchedNgx.includes(`combined; ${TRAFFIC_LOG_MARK}`), "plan nginx inserta access_log combined con marca");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`OK (${passed} comprobaciones de webTraffic)`);
