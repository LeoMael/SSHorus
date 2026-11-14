// Pruebas de la regla de dueño del mapa (en qué caja va cada cosa).
// Ejecutar: npx rolldown src/features/infra/owner.test.ts -p node -f esm -o /tmp/owner.mjs && node /tmp/owner.mjs
import { ownerLabel, resolveOwner, sortOwners, SYSTEM_OWNER, UNKNOWN_OWNER, webServerOwner, type OwnerContext } from "./owner";
import { parseConfigOwners, parsePidUsers } from "./parse";
import { parseProcs } from "../admin/ports";

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

const humans = new Set(["deploy", "ana"]);
const noSudo: OwnerContext = { me: "deploy", seesAll: false, humans };
const sudo: OwnerContext = { me: "deploy", seesAll: true, humans };
const asRoot: OwnerContext = { me: "root", seesAll: true, humans };
const acc = (user: string | null) => ({ kind: "account", user }) as const;

// Sin sudo.
eq(resolveOwner(acc("deploy"), noSudo), "deploy", "sin sudo: su proceso, en su caja");
eq(resolveOwner(acc(null), noSudo), UNKNOWN_OWNER, "sin sudo: puerto sin proceso visible → sin identificar");
eq(resolveOwner({ kind: "unit", scope: "user", user: "deploy" }, noSudo), "deploy", "sin sudo: su systemctl --user");
eq(resolveOwner({ kind: "unit", scope: "system", user: "deploy" }, noSudo), SYSTEM_OWNER, "servicio del sistema que corre como él: sistema");
eq(resolveOwner(acc("root"), noSudo), SYSTEM_OWNER, "contenedor rootful (grupo docker): sistema");
eq(resolveOwner(acc(""), noSudo), UNKNOWN_OWNER, "sin dueño conocido: nunca el conectado");

// Con sudo.
eq(resolveOwner(acc(null), sudo), SYSTEM_OWNER, "con sudo: puerto sin proceso (del núcleo) → sistema");
eq(resolveOwner(acc("ana"), sudo), "ana", "con sudo: contenedor rootless de otro usuario, en su caja");
eq(resolveOwner(acc("postgres"), sudo), SYSTEM_OWNER, "usuario del sistema (uid < 1000): sistema");
eq(resolveOwner({ kind: "unit", scope: "system", user: "root" }, sudo), SYSTEM_OWNER, "servicio de sistema: sistema");
eq(resolveOwner({ kind: "unit", scope: "user", user: "ana" }, sudo), "ana", "systemctl --user de otro usuario");
eq(resolveOwner({ kind: "system" }, noSudo), SYSTEM_OWNER, "cortafuegos: sistema");

// Conectado como root.
eq(resolveOwner(acc("root"), asRoot), SYSTEM_OWNER, "root: lo suyo es del sistema");
eq(resolveOwner(acc("ana"), asRoot), "ana", "root: lo de ana, en la caja de ana");

// Sin lista de usuarios (getent falló): solo el conectado es «suyo».
const bare: OwnerContext = { me: "deploy", seesAll: false, humans: null };
eq(resolveOwner(acc("deploy"), bare), "deploy", "sin lista: el conectado");
eq(resolveOwner(acc("www-data"), bare), SYSTEM_OWNER, "sin lista: otro usuario → sistema");

// Servidores web (nginx/Caddy).
eq(webServerOwner({ status: "active", configOwner: "deploy" }, noSudo), SYSTEM_OWNER, "con unidad systemd del sistema: sistema");
eq(webServerOwner({ status: null, configOwner: "root" }, noSudo), SYSTEM_OWNER, "configuración de root: sistema");
eq(webServerOwner({ status: null, configOwner: "ana" }, noSudo), "ana", "configuración de ana: ana");
eq(webServerOwner({ status: null, configOwner: null }, noSudo), null, "sin pistas: se mira el proceso");

// Orden y títulos.
eq(sortOwners([UNKNOWN_OWNER, "ana", "deploy", SYSTEM_OWNER], "deploy"), [SYSTEM_OWNER, "deploy", "ana", UNKNOWN_OWNER], "orden de las cajas");
eq(ownerLabel(UNKNOWN_OWNER), "Sin identificar (haría falta sudo)", "título de la caja");
eq(ownerLabel(SYSTEM_OWNER, true), "Sistema", "chip");
eq(ownerLabel("ana"), "ana", "usuario tal cual");

// Lecturas del servidor que usa la regla.
const procs = parseProcs(["812|deploy|api.service|user", "1201|root|nginx.service|system", "900|root|session-3.scope|system", "50|root"]);
eq([procs.get(812)?.userUnit, procs.get(1201)?.userUnit, procs.get(900)?.unit, procs.get(50)?.userUnit], [true, false, null, false], "servicio --user o del sistema (cgroup)");
eq([...parsePidUsers(["812|deploy", "900|", "x|y"])], [[812, "deploy"]], "usuario de cada pid con conexiones");
eq(parseConfigOwners("root|/etc/nginx/nginx.conf\n|/etc/caddy/Caddyfile\nana|/home/ana/Caddy file\n"), { "/etc/nginx/nginx.conf": "root", "/home/ana/Caddy file": "ana" }, "dueños de la configuración");

console.log(fails ? `${fails} de ${n} pruebas FALLARON` : `OK: ${n} pruebas`);
if (fails) throw new Error("pruebas fallidas");
