// Pruebas de la lectura del cortafuegos: firewalld (zonas, servicios, reglas enriquecidas), ufw (verbose,
// numbered, show added), nftables (JSON con Docker y Podman), iptables-save y las frases simples.
import { DEBIAN, NO_SUDO, OLD_SERVER, ROCKY, UBUNTU, UBUNTU_OFF, UFW_NUMBERED } from "./fixtures";
import { ipInNet, parsePortList } from "./common";
import { policyLines, ruleText, statusText } from "./explain";
import { parseRichRule } from "./firewalld";
import { canManage, parseFirewallReport } from "./report";
import type { FwReport, FwRule } from "./types";
import { parseUfwCommand, parseUfwStatus } from "./ufw";

let n = 0;
function eq(got: unknown, want: unknown, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  n++;
}
const texts = (r: FwReport, rules: FwRule[] = r.rules) => rules.map((x) => ruleText(x, r));

// ───────── Comunes ─────────
eq(parsePortList("80,443"), [{ from: 80, to: 80 }, { from: 443, to: 443 }], "lista de puertos");
eq(parsePortList("8000:8010"), [{ from: 8000, to: 8010 }], "rango con :");
eq(parsePortList("9000-9010"), [{ from: 9000, to: 9010 }], "rango con -");
eq(parsePortList("70000"), null, "puerto fuera de rango");
eq(parsePortList("ssh"), null, "nombre no es puerto");
eq(ipInNet("10.1.2.3", "10.0.0.0/8"), true, "IPv4 dentro de la red");
eq(ipInNet("11.0.0.1", "10.0.0.0/8"), false, "IPv4 fuera");
eq(ipInNet("203.0.113.66", "203.0.113.66"), true, "IP suelta");
eq(ipInNet("2001:db8::5", "2001:db8::/32"), true, "IPv6 dentro");
eq(ipInNet("2001:db9::5", "2001:db8::/32"), false, "IPv6 fuera");
eq(ipInNet("10.0.0.1", "2001:db8::/32"), false, "familias distintas");
eq(ipInNet("hola", "10.0.0.0/8"), null, "no es una IP");

// ───────── firewalld (Rocky) ─────────
const rocky = parseFirewallReport(ROCKY);
eq([rocky.tool, rocky.active, rocky.readable, rocky.defaultZone], ["firewalld", true, true, "public"], "firewalld activo");
eq(rocky.zones.filter((z) => z.active).map((z) => z.name), ["docker", "public"], "zonas activas");
eq(rocky.zones.find((z) => z.name === "public")?.richRules.length, 2, "reglas enriquecidas");
eq(rocky.services.ssh, [{ proto: "tcp", ports: [{ from: 22, to: 22 }] }], "puertos del servicio ssh");
eq(
  texts(rocky),
  [
    "Bloquea la entrada desde 203.0.113.66 (solo IPv4)",
    "Permite entrar por el servicio «cockpit» (TCP 9090) desde cualquier sitio",
    "Permite entrar por el servicio «dhcpv6-client» (UDP 546) desde cualquier sitio",
    "Permite entrar por el servicio «ssh» (TCP 22) desde cualquier sitio",
    "Permite entrar por TCP 8080 (HTTP alternativo) desde cualquier sitio",
    "Permite entrar por UDP 9000-9010 desde cualquier sitio",
    "Permite entrar por TCP 5432 (PostgreSQL) solo desde 10.0.0.0/8 (solo IPv4)",
    "Redirige TCP 8443 (HTTPS alternativo) hacia 443",
    "Comparte la conexión de la máquina con las redes internas (NAT)",
  ],
  "firewalld en palabras (rechazos primero)",
);
eq(rocky.rules[0].ref, { tool: "firewalld", zone: "public", kind: "rich", value: 'rule family="ipv4" source address="203.0.113.66" drop' }, "cómo quitar una regla enriquecida");
eq(
  policyLines(rocky),
  ["Zona «docker» · docker0: se permite todo.", "Zona «public» (por defecto) · eth0: lo que no está permitido se rechaza."],
  "políticas de las zonas",
);
eq(canManage(rocky), true, "firewalld se puede gestionar");
eq(statusText(rocky), "firewalld activo", "estado");
eq(parseRichRule('rule family="ipv6" source NOT address="2001:db8::/32" service name="http" reject').extra, true, "NOT = más condiciones");
eq(parseRichRule('rule service name="http" log prefix="x" limit value="3/m" accept').verdict, "limit", "limit en rich rule");

// ───────── ufw (Ubuntu) ─────────
const ubuntu = parseFirewallReport(UBUNTU);
eq([ubuntu.tool, ubuntu.active], ["ufw", true], "ufw activo (aunque nft tenga tablas)");
eq(ubuntu.ufwDefaults, { incoming: "deny", outgoing: "allow", routed: "disabled" }, "políticas de ufw");
eq(ubuntu.rules.length, 7, "las reglas (v6) se juntan con su gemela");
eq(
  texts(ubuntu),
  [
    "Permite entrar por TCP 22 (SSH) desde cualquier sitio, pero frena a quien lo intenta muchas veces seguidas",
    "Permite entrar por TCP 80, 443 desde cualquier sitio",
    "Permite entrar por TCP 5432 (PostgreSQL) solo desde 192.168.1.0/24",
    "Bloquea la entrada desde 203.0.113.4",
    "Permite entrar por el servicio «Nginx Full» (TCP 80, 443) desde cualquier sitio",
    "Permite entrar por TCP 8000-8010 desde cualquier sitio",
    "Permite entrar por TCP y UDP 3000 (App web (Node, Grafana…)) desde cualquier sitio por la interfaz eth1",
  ],
  "ufw en palabras",
);
eq(ubuntu.rules[1].comment, "web", "comentario de ufw");
eq(
  ubuntu.rules.map((r) => (r.ref?.tool === "ufw" ? r.ref.spec.join(" ") : null)),
  ["limit 22/tcp", "allow 80,443/tcp", "allow from 192.168.1.0/24 to any port 5432 proto tcp", "deny from 203.0.113.4", "allow Nginx Full", "allow 8000:8010/tcp", null],
  "argumentos de ufw para quitar cada regla (la de interfaz, a mano)",
);
eq(ubuntu.ufwAdded.map((r) => r.ref?.tool === "ufw" && r.ref.spec.join(" ")), ["limit 22/tcp", "allow 80,443/tcp"], "ufw show added (sin el comentario)");
eq(
  policyLines(ubuntu),
  ["Entrada: lo que no está en la lista se bloquea.", "Salida: se permite.", "Paso a otras redes (contenedores, router): está desactivado."],
  "políticas de ufw en palabras",
);
const numbered = parseUfwStatus(UFW_NUMBERED.split("\n"));
eq([numbered.active, numbered.rules.length], [true, 3], "ufw status numbered");
eq([numbered.rules[2].extra, numbered.rules[2].ref], [true, null], "regla hacia una dirección concreta: más condiciones");
eq(parseUfwCommand("ufw allow from 10.0.0.0/8 to any port 5432 proto tcp", "x")?.source, "10.0.0.0/8", "show added con origen");
eq(parseUfwCommand("ufw allow 'Nginx Full'", "x")?.ports.length, 2, "perfil de aplicación con comillas");
eq(parseUfwCommand("ufw route allow 80", "x"), null, "lo que no se entiende se ignora");

const off = parseFirewallReport(UBUNTU_OFF);
eq([off.tool, off.active, off.ufwAdded.length], ["ufw", false, 2], "ufw instalado pero apagado");
eq(statusText(off), "ufw instalado pero apagado", "estado apagado");
eq(policyLines(off), [], "apagado: sin políticas");

// ───────── nftables (Debian con Docker y Podman) ─────────
const deb = parseFirewallReport(DEBIAN);
eq([deb.tool, deb.active], ["nftables", true], "nftables activo");
eq(
  texts(deb),
  [
    "Deja pasar las respuestas de las conexiones ya abiertas",
    "Permite el tráfico interno de la propia máquina (lo)",
    "Permite entrar por TCP 22 (SSH) desde cualquier sitio",
    "Permite entrar por TCP 5432 (PostgreSQL) solo desde 10.0.0.0/8 (solo IPv4)",
    "Pasa a revisar la cadena «web» para TCP 80, 443",
    "Permite entrar todo el tráfico ICMP (ping) desde cualquier sitio",
    "Permite entrar cualquier tráfico desde cualquier sitio",
  ],
  "nftables en palabras (la cadena «web» hereda la entrada)",
);
eq(deb.rules[2].raw, "tcp dport 22 counter packets 10 bytes 600 accept", "texto original por handle");
eq(deb.rules[3].comment, "postgres interno", "comentario de nft");
eq(
  deb.managed.map((r) => [r.place, r.managedBy]),
  [["ip filter FORWARD", "docker"], ["ip filter DOCKER", "docker"], ["inet netavark FORWARD", "podman"]],
  "reglas de Docker y Podman aparte",
);
eq(ruleText(deb.managed[1], deb).endsWith("· de Docker"), true, "se dice quién la creó");
eq(deb.managed[1].extra, true, "la de Docker tiene más condiciones (destino, interfaces)");
eq(policyLines(deb)[0], "Cadena «inet filter input» (entrada): lo que no encaja en ninguna regla se descarta.", "política de la cadena");
eq(canManage(deb), false, "nftables: solo lectura");

// ───────── iptables (servidor viejo) ─────────
const old = parseFirewallReport(OLD_SERVER);
eq([old.tool, old.active], ["iptables", true], "iptables-save");
eq(
  texts(old),
  [
    "Permite el tráfico interno de la propia máquina (lo)",
    "Deja pasar las respuestas de las conexiones ya abiertas",
    "Permite entrar por TCP 2222 desde cualquier sitio",
    "Permite entrar por TCP 80, 443 solo desde 192.168.0.0/16",
    "Rechaza la entrada por TCP 23 desde cualquier sitio (avisando a quien lo intenta)",
  ],
  "iptables en palabras",
);
eq(old.rules[3].comment, "web interna", "comentario entre comillas");
eq(
  old.managed.map((r) => r.place),
  ["nat PREROUTING", "nat POSTROUTING", "nat DOCKER", "nat DOCKER", "filter FORWARD", "filter FORWARD", "filter DOCKER", "filter DOCKER-USER"],
  "todo lo de Docker, también en nat",
);

// ───────── Sin sudo ─────────
const nos = parseFirewallReport(NO_SUDO);
eq([nos.tool, nos.readable, nos.rules.length], ["ufw", false, 0], "sin sudo: se sabe que hay ufw, pero no sus reglas");
eq(nos.notes.length, 1, "se explica que falta sudo");
eq(statusText(nos), "ufw: sin sudo no se ve si está activo", "sin sudo no se dice «apagado»");

console.log(`firewall (lectura): ${n} comprobaciones OK`);
