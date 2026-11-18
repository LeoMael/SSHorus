// Pruebas de la lógica pura de la barra lateral: estado de pestañas, búsqueda, claves y teclado.
// Ejecutar: npx rolldown src/components/Sidebar/sidebarLogic.test.ts -p node -f esm -o /tmp/sb.mjs && node /tmp/sb.mjs
import type { Project, ServerProfile } from "../../api/types";
import {
  bookmarkRowKey,
  filterProjects,
  isNavKey,
  matchesServer,
  navIndex,
  parseTabStates,
  projectServers,
  serverRowKey,
  tabStatesKey,
  validateBookmarkPath,
} from "./sidebarLogic";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

function server(id: string, name = id, username = "root"): ServerProfile {
  return {
    id,
    name,
    host: `${id}.example`,
    port: 22,
    username,
    auth: "password",
    keyPath: null,
    defaultPath: null,
    color: null,
  };
}

function project(id: string, name: string, serverIds: string[]): Project {
  return {
    id,
    name,
    serverIds,
    bookmarks: serverIds.map((s) => ({ serverId: s, path: `/srv/${s}`, label: null })),
    color: null,
  };
}

// ── tabStatesKey / parseTabStates ──
const key = tabStatesKey([
  { profileId: "b", status: "closed" },
  { profileId: "a", status: "reconnecting" },
  { profileId: "b", status: "connected" },
  { profileId: "a", status: "closed" },
]);
eq(key, "a:reconnecting\nb:connected", "mejor estado por servidor, ordenado");
eq(tabStatesKey([]), "", "sin pestañas");
eq([...parseTabStates(key)], [["a", "reconnecting"], ["b", "connected"]], "ida y vuelta");
eq([...parseTabStates("")], [], "texto vacío");
eq([...parseTabStates("id:con:dos-puntos:closed")], [["id:con:dos-puntos", "closed"]], "id con «:»");

// ── matchesServer ──
const web = server("web", "Web Prod", "deploy");
eq(matchesServer(web, "prod"), true, "por nombre (sin mayúsculas)");
eq(matchesServer(web, "web.example"), true, "por host");
eq(matchesServer(web, "deploy"), true, "por usuario");
eq(matchesServer(web, "db"), false, "no coincide");

// ── projectServers / filterProjects ──
const servers = [web, server("db", "Base de datos"), server("cache")];
const byId = new Map(servers.map((s) => [s.id, s]));
const pApp = project("app", "Aplicación", ["web", "db", "borrado"]);
const pOps = project("ops", "Operaciones", ["cache"]);
eq(projectServers(pApp, byId).map((s) => s.id), ["web", "db"], "sin servidores borrados");

const ids = (q: string) =>
  filterProjects([pApp, pOps], byId, q).map((e) => [e.project.id, e.servers.map((s) => s.id), e.bookmarks.map((b) => b.path)]);
eq(
  ids(""),
  [
    ["app", ["web", "db"], ["/srv/web", "/srv/db", "/srv/borrado"]],
    ["ops", ["cache"], ["/srv/cache"]],
  ],
  "sin búsqueda: todo",
);
eq(ids("aplica"), [["app", ["web", "db"], ["/srv/web", "/srv/db", "/srv/borrado"]]], "nombre del proyecto: entero");
eq(ids("prod"), [["app", ["web"], ["/srv/web"]]], "solo lo que coincide (servidor y su marcador)");
eq(ids("srv/cache"), [["ops", [], ["/srv/cache"]]], "por ruta del marcador");
eq(ids("nada"), [], "sin coincidencias");

// ── claves de filas ──
eq(serverRowKey("s1"), "s:s1", "servidor suelto");
eq(serverRowKey("s1", ""), "s:s1", "proyecto vacío = suelto");
eq(serverRowKey("s1", "p1"), "p:p1:s:s1", "servidor en proyecto");
eq(bookmarkRowKey("p1", { serverId: "s1", path: "/var", label: null }), "b:p1:s1:/var", "marcador");

// ── teclado ──
eq(["ArrowDown", "ArrowUp", "Home", "End", "Enter"].map(isNavKey), [true, true, true, true, false], "teclas de navegación");
eq(navIndex("ArrowDown", -1, 5), 0, "abajo sin foco");
eq(navIndex("ArrowDown", 2, 5), 3, "abajo");
eq(navIndex("ArrowDown", 4, 5), 4, "abajo en la última");
eq(navIndex("ArrowUp", -1, 5), 0, "arriba sin foco");
eq(navIndex("ArrowUp", 0, 5), 0, "arriba en la primera");
eq(navIndex("ArrowUp", 3, 5), 2, "arriba");
eq(navIndex("Home", 3, 5), 0, "inicio");
eq(navIndex("End", 0, 5), 4, "fin");

// ── marcadores ──
eq(validateBookmarkPath(" /var/www "), null, "ruta absoluta");
eq(validateBookmarkPath("~/app"), null, "desde el home");
eq(validateBookmarkPath("var/www"), "Escribe una ruta absoluta (/…)", "ruta relativa");

console.log(`sidebarLogic: ${passed} comprobaciones correctas`);
