// Pruebas de «Lo mío» / «Todo el servidor» del mapa. Caso real: usuario «tesis» sin sudo ni hidepid, con
// su servicio --user y su contenedor rootless «tesis-servidor» (127.0.0.1:8096 por pasta) detrás de Caddy.
// Ejecutar: npx rolldown src/features/infra/scope.test.ts -p node -f esm -o /tmp/scope.mjs && node /tmp/scope.mjs
import type { Site } from "../admin/web";
import { buildGraph, type InfraGraph, type ServerSnapshot } from "./graph";
import { layoutGraph } from "./layout";
import { NO_SUDO_NOTE, ROUTE_OWNER, SYSTEM_OWNER, UNKNOWN_OWNER } from "./owner";
import { parseInfra } from "./parse";
import { ctr, humans, port } from "./sample";
import { defaultScope, mapNotes, mineUsers, othersText, scopeGraph, scopeNote, serverScopes } from "./scope";

let fails = 0;
let n = 0;
function eq(a: unknown, b: unknown, msg: string) {
  n++;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) {
    fails++;
    console.error(`FALLO: ${msg}\n  obtenido: ${sa}\n  esperado: ${sb}`);
  }
}
const ok = (c: boolean, msg: string) => eq(c, true, msg);

function caddySite(key: string, name: string, upstream: number): Site {
  return {
    key,
    server: "caddy",
    names: [name],
    listens: [
      { host: null, port: 443, https: true },
      { host: null, port: 80, https: false },
    ],
    https: true,
    isDefault: false,
    cert: null,
    certExpires: null,
    routes: [{ path: "/", target: { kind: "proxy", url: `http://localhost:${upstream}`, host: "localhost", port: upstream, socket: null } }],
    file: "/etc/caddy/Caddyfile",
    line: 1,
  };
}

function tesisVps(): ServerSnapshot {
  return {
    id: "vps",
    name: "vps",
    host: "198.51.100.20",
    sessionId: "s1",
    error: null,
    elevated: false,
    canSudo: false,
    me: "tesis",
    ports: {
      tool: "ss",
      ports: [
        // Sin sudo, `ss -p` no dice qué proceso de root u otro usuario escucha.
        port(22, "0.0.0.0", null, 0, null),
        port(80, "0.0.0.0", null, 0, null),
        port(443, "0.0.0.0", null, 0, null),
        port(5432, "127.0.0.1", null, 0, null),
        port(3000, "127.0.0.1", null, 0, null),
        port(9000, "0.0.0.0", "node", 7100, "leo_oti"),
        port(8096, "127.0.0.1", "pasta.avx2", 5100, "tesis"),
      ],
    },
    web: {
      servers: [
        {
          server: "caddy",
          source: "adapt",
          configPath: "/etc/caddy/Caddyfile",
          status: "active",
          warning: null,
          sites: [caddySite("tesis", "tesis.example.com", 8096), caddySite("otro", "leo.example.com", 3000)],
        },
      ],
    },
    containers: [
      ctr("tesis-servidor", "localhost/tesis-servidor:latest", "tesis", {
        ports: [{ hostIp: "127.0.0.1", hostPort: 8096, containerPort: 8096, protocol: "tcp", range: 1 }],
      }),
    ],
    extra: {
      os: "Ubuntu 24.04 LTS",
      hostname: "vps",
      addrs: ["198.51.100.20"],
      firewall: [],
      humans: humans([
        ["leo", 1000],
        ["leo_oti", 1001],
        ["tesis", 1002],
      ]),
      established: [],
      procUsers: new Map(),
      userServices: ["tesis-servidor.service"],
      othersVisible: true,
    },
    userServices: { tesis: ["tesis-servidor.service"] },
    configOwners: { "/etc/caddy/Caddyfile": "root" },
    notes: [NO_SUDO_NOTE],
  };
}

// ───────── Alcance por defecto ─────────
const vps = tesisVps();
eq(defaultScope(vps), "mine", "usuario normal sin sudo: «Lo mío»");
eq(defaultScope({ ...vps, canSudo: true }), "all", "con sudo (aunque no se usara): «Todo el servidor»");
eq(defaultScope({ ...vps, elevated: true }), "all", "leído con sudo: «Todo el servidor»");
eq(defaultScope({ ...vps, me: "root", elevated: true }), "all", "root: «Todo el servidor»");
eq([...serverScopes([vps, { ...vps, id: "r", me: "root" }], {})], [["vps", "mine"]], "root no tiene «Lo mío»");
eq(serverScopes([vps], { vps: "all" }).get("vps"), "all", "se recuerda lo elegido por servidor");
eq(serverScopes([{ ...vps, offline: true }], {}).size, 0, "sin conexión: nada que elegir");

// ───────── Grafo completo: el puerto 443 lleva a Caddy aunque no se vea su proceso ─────────
const full = buildGraph([vps]);
const fid = (label: string) => full.nodes.find((x) => x.label === label)?.id;
const caddy = full.nodes.find((x) => x.kind === "proxy");
eq(caddy?.owner, SYSTEM_OWNER, "Caddy con unidad systemd: sistema");
ok(full.edges.some((e) => e.from === "vps|port:tcp:443" && e.to === caddy?.id), ":443 → Caddy (sus sitios escuchan ahí)");
ok(full.edges.some((e) => e.from === "vps|port:tcp:443" && e.to === "vps|proc:?:tcp:443"), "y sigue el «¿?» sin identificar");
eq(full.nodes.find((x) => x.id === "vps|proc:?:tcp:443")?.owner, UNKNOWN_OWNER, "sin inventar el dueño del :443");
ok(full.edges.some((e) => e.from === fid("tesis.example.com") && e.to === "vps|ctr:tesis:tesis-servidor"), "sitio → contenedor por pasta");

// ───────── «Lo mío» ─────────
const mine = scopeGraph(full, mineUsers([vps], serverScopes([vps], {})));
const ids = mine.nodes.map((x) => x.id).sort();
eq(
  ids,
  [
    "internet",
    "vps|ctr:tesis:tesis-servidor",
    "vps|port:tcp:443",
    "vps|port:tcp:80",
    "vps|proxy:caddy",
    "vps|site:tesis",
    "vps|svc:tesis:tesis-servidor.service",
  ].sort(),
  "solo lo suyo y el camino desde Internet",
);
const owner = (id: string) => mine.nodes.find((x) => x.id === id)?.owner;
eq([owner("vps|ctr:tesis:tesis-servidor"), owner("vps|svc:tesis:tesis-servidor.service")], ["tesis", "tesis"], "contenedor y servicio --user, suyos");
eq([owner("vps|port:tcp:443"), owner("vps|proxy:caddy"), owner("vps|site:tesis")], [ROUTE_OWNER, ROUTE_OWNER, ROUTE_OWNER], "camino en gris («del sistema»)");
eq(mine.servers[0].owners, [ROUTE_OWNER, "tesis"], "dos bandas: camino y lo suyo");
// Ocultos: ¿?:22/80/443/5432/3000, node de leo_oti, el otro sitio (los puertos no cuentan).
eq(mine.servers[0].hidden, 7, "lo demás, plegado en «Otros»");
eq(othersText(7), "Otros: 7 servicios del sistema y de otros usuarios", "texto de la caja");
eq(othersText(1), "Otros: 1 servicio del sistema y de otros usuarios", "singular");
ok(!mine.nodes.some((x) => x.label === "leo.example.com"), "el sitio de otro no aparece");
ok(mine.edges.every((e) => ids.includes(e.from) && ids.includes(e.to)), "aristas solo entre nodos visibles");
eq(mine.edges.filter((e) => e.from === "internet").map((e) => e.to).sort(), ["vps|port:tcp:443", "vps|port:tcp:80"], "Internet → 80/443");
ok(scopeGraph(full, new Map()) === full, "«Todo el servidor»: el grafo tal cual");

// Disposición con la caja plegada.
function check(g: InfraGraph): string | null {
  const L = layoutGraph(g);
  const s = L.servers[0];
  if (!s.fold) return "sin caja «Otros»";
  for (const b of s.bands) if (b.y + b.h > s.fold.y) return "banda encima de «Otros»";
  if (s.fold.y + s.fold.h > s.y + s.h) return "«Otros» fuera del servidor";
  return null;
}
eq(check(mine), null, "«Otros» debajo de las bandas y dentro del servidor");
eq(layoutGraph(full).servers[0].fold, null, "en «Todo el servidor» no hay caja plegada");
{
  const empty = scopeGraph(full, new Map([["vps", "nadie"]]));
  eq(empty.servers[0].owners, [], "usuario sin nada: sin bandas");
  eq(check(empty), null, "solo la caja «Otros»");
}

// ───────── Frases ─────────
eq(
  scopeNote("mine", vps),
  "Ves solo lo tuyo. Este servidor deja a cualquier usuario ver los procesos de otros (solo lectura); con sudo podrías verlo todo con detalle.",
  "«Lo mío» sin sudo",
);
eq(scopeNote("mine", { ...vps, othersVisible: false }), "Ves solo lo tuyo. Con sudo podrías ver también lo del sistema y de otros usuarios.", "con hidepid no se dice que se vea lo de otros");
eq(scopeNote("all", vps), "Puedes verlo, pero no cambiarlo: es de root o de otros usuarios.", "«Todo el servidor» sin sudo");
eq(scopeNote("all", { ...vps, elevated: true }), null, "con sudo, nada que aclarar");
eq(scopeNote(undefined, vps), null, "sin selector, sin frase");
{
  const notes = mapNotes([vps], serverScopes([vps], {}));
  eq(notes.scope.length, 1, "una frase de alcance");
  eq(notes.other, [], "sustituye al aviso genérico de «sin sudo»");
  eq(mapNotes([{ ...vps, me: null }], new Map()).other, [NO_SUDO_NOTE], "sin selector se queda el aviso");
}

// Lectura de si se ven los procesos de otros.
const procvis = (v: string) => parseInfra(`@@procvis\n${v}\n@@end`).othersVisible;
eq([procvis("1"), procvis("0"), procvis("")], [true, false, null], "/proc legible o no (hidepid)");

console.log(fails ? `${fails} de ${n} pruebas FALLARON` : `OK: ${n} pruebas`);
if (fails) throw new Error("pruebas fallidas");
