// Pruebas de las cuentas agrupadas por servidor en la barra lateral: host, cuentas sueltas, sudo primero,
// sudo desconocido y proyectos.
import type { ServerProfile } from "../../api/types";
import { accountAdmin } from "../privileges/detect";
import { knownAdminFor } from "../privileges/knownAdmin";
import {
  bestAdmin,
  groupByMachine,
  machineKey,
  machineRowKey,
  resolveSudo,
  type ServerTreeItem,
  type SudoBadge,
} from "./machineGroups";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

function srv(id: string, name: string, username: string, host: string, port = 22, extra: Partial<ServerProfile> = {}): ServerProfile {
  return { id, name, host, port, username, auth: "key", keyPath: null, defaultPath: null, color: null, ...extra };
}

/** Árbol en forma corta: "nombre" para filas sueltas, "host[a*, b]" para máquinas (* = marca de sudo). */
function shape(items: ServerTreeItem[]): string[] {
  const acc = (a: { server: ServerProfile; sudo: SudoBadge | null }) => `${a.server.name}${a.sudo ? "*" : ""}`;
  return items.map((it) => (it.kind === "server" ? acc(it.account) : `${it.label}[${it.accounts.map(acc).join(", ")}]`));
}

const tesis = srv("1", "TESIS", "tesis", "2.25.131.217");
const leo = srv("2", "Leo", "leo", "2.25.131.217");
const portal = srv("3", "Portal", "developer", "172.80.80.64");
const leoOti = srv("4", "Leo_oti", "leo_oti", "2.25.131.217");
const servers = [tesis, leo, portal, leoOti];
const sudoIds = new Set(["2"]);
const sudoOf = (s: ServerProfile): SudoBadge | null => (sudoIds.has(s.id) ? "sudo" : null);

// --- Agrupado: el caso del usuario ---
eq(shape(groupByMachine(servers, sudoOf)), ["2.25.131.217[Leo*, Leo_oti, TESIS]", "Portal"], "mismo host juntos, sudo primero");
eq(shape(groupByMachine(servers, () => null)), ["2.25.131.217[Leo, Leo_oti, TESIS]", "Portal"], "sin sudo conocido: alfabético");
eq(shape(groupByMachine([portal, ...servers.filter((s) => s !== portal)], sudoOf))[0], "Portal", "el grupo sale donde estaba su primera cuenta");

// --- Host: mayúsculas y espacios no cuentan; el puerto sí ---
eq(machineKey(srv("a", "a", "a", " Web.Example.COM ")), machineKey(srv("b", "b", "b", "web.example.com")), "host sin mayúsculas ni espacios");
eq(
  shape(groupByMachine([srv("a", "a", "u1", "Host.lan"), srv("b", "b", "u2", "host.lan")], () => null)),
  ["Host.lan[a, b]"],
  "mismo host escrito distinto: una máquina",
);
eq(
  shape(groupByMachine([srv("a", "a", "u1", "h"), srv("b", "b", "u2", "h", 2222), srv("c", "c", "u3", "h", 2222)], () => null)),
  ["a", "h:2222[b, c]"],
  "otro puerto es otra máquina (y se ve en la etiqueta)",
);
eq(shape(groupByMachine([srv("a", "a", "u", ""), srv("b", "b", "u", "")], () => null)), ["a", "b"], "sin host no se agrupan");

// --- Cuentas sueltas ---
eq(shape(groupByMachine([portal], sudoOf)), ["Portal"], "una sola cuenta: fila normal");
eq(groupByMachine([], sudoOf).length, 0, "lista vacía");

// --- Orden: root y sudo primero, luego por nombre ---
const mixed = [srv("x", "zeta", "z", "h"), srv("y", "Alfa", "a", "h"), srv("r", "raíz", "root", "h"), srv("w", "beta", "b", "h")];
const mixedSudo = (s: ServerProfile): SudoBadge | null => (s.username === "root" ? "root" : s.id === "x" ? "sudo" : null);
eq(shape(groupByMachine(mixed, mixedSudo)), ["h[raíz*, zeta*, Alfa, beta]"], "administradores primero, luego alfabético");
eq(shape(groupByMachine([srv("a", "srv10", "a", "h"), srv("b", "srv9", "b", "h")], () => null)), ["h[srv9, srv10]"], "números en orden natural");

// --- Proyectos: se agrupan solo sus servidores, con su propia clave de plegado ---
eq(shape(groupByMachine([tesis, portal], sudoOf)), ["TESIS", "Portal"], "en un proyecto con una cuenta de la máquina: sin nodo");
eq(shape(groupByMachine([leoOti, leo], sudoOf)), ["2.25.131.217[Leo*, Leo_oti]"], "en un proyecto con dos: nodo");
eq(machineRowKey("h:22", "p1"), "p:p1:m:h:22", "clave en un proyecto");
eq(machineRowKey("h:22"), "m:h:22", "clave en «Servidores»");
eq(machineRowKey("h:22", ""), "m:h:22", "proyecto vacío = «Servidores»");

// --- De dónde sale la marca de sudo ---
const plain = { username: "leo", auth: "key" as const, sudoMode: undefined };
eq(resolveSudo("sudo", null, plain), "sudo", "detectado en una conexión abierta");
eq(resolveSudo("user", "sudo", plain), null, "lo detectado ahora gana a lo guardado");
eq(resolveSudo(null, "sudo", plain), "sudo", "sin conexión: lo último que se vio");
eq(resolveSudo(null, "user", { ...plain, sudoMode: "saved" }), null, "lo visto gana al perfil");
eq(resolveSudo(null, null, plain), null, "sin datos: sin marca");
eq(resolveSudo(null, null, { ...plain, username: "root" }), "root", "usuario root");
eq(resolveSudo(null, null, { ...plain, sudoMode: "saved" }), "sudo", "contraseña de sudo guardada en el perfil");
eq(resolveSudo(null, null, { ...plain, sudoMode: "login" }), null, "«la de la conexión» sin contraseña de conexión no cuenta");
eq(resolveSudo(null, null, { ...plain, auth: "password", sudoMode: "login" }), "sudo", "«la de la conexión» con contraseña");
eq(resolveSudo(null, null, { ...plain, sudoMode: "ask" }), null, "«pedir cada vez» no dice nada");

eq(bestAdmin(["user", null, "sudo"]), "sudo", "varias pestañas: la mejor");
eq(bestAdmin(["sudo", "root"]), "root", "root gana");
eq(bestAdmin([null, undefined]), null, "nada detectado");

eq(accountAdmin("root"), "root", "nivel root");
eq(accountAdmin("sudo-nopasswd"), "sudo", "sudo sin contraseña");
eq(accountAdmin("sudo"), "sudo", "sudo con contraseña");
eq(accountAdmin("user"), "user", "usuario normal");
eq(accountAdmin("maybe-sudo"), null, "puede que tenga sudo: no está claro");
eq(accountAdmin("unknown"), null, "sin comprobar");

eq(knownAdminFor({ level: "sudo", user: "leo" }, "leo"), "sudo", "guardado con el mismo usuario");
eq(knownAdminFor({ level: "sudo", user: "leo" }, "tesis"), null, "el servidor se editó con otro usuario");
eq(knownAdminFor({ level: "root", user: null }, "root"), "root", "guardado sin usuario");
eq(knownAdminFor(undefined, "leo"), null, "nada guardado");

console.log(`machineGroups: ${passed} comprobaciones correctas`);
