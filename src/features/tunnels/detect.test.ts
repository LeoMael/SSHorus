// Pruebas de «Servicios que puedes traer»: reconocer servicios y juntar puertos y contenedores.
// Ejecutar: npx rolldown src/features/tunnels/detect.test.ts -p node -f esm -o /tmp/tt.mjs && node /tmp/tt.mjs
import { parsePorts } from "../admin/ports";
import {
  browserUrl,
  connectionString,
  findLocalTunnel,
  findServices,
  identifyService,
  parseContainerPublish,
  serviceTitle,
  wantedLocalPort,
} from "./detect";
import type { TunnelDef } from "../../api/tunnels";
import { groupByCategory } from "./categories";
import { applyHttpProbe, httpProbeScript, parseHttpProbe } from "./probe";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const id = (names: string[], ports: number[]) => identifyService(names, ports)?.id ?? null;

// ── Reconocer el servicio ──
eq(id(["postgres"], [5432]), "postgres", "proceso y puerto");
eq(id(["postgres"], [5433]), "postgres", "PostgreSQL en otro puerto, por el proceso");
eq(id([], [5432]), "postgres", "sin proceso (sin sudo): por el puerto");
eq(id(["mariadbd"], [3306]), "mysql", "MariaDB");
eq(id(["beam.smp"], [15672]), "rabbitmq-panel", "RabbitMQ: el panel por el puerto");
eq(id(["beam.smp"], [5672]), "rabbitmq", "RabbitMQ: la cola");
eq(id(["node"], [3000]), "web", "una app Node en el 3000 no es Grafana");
eq(id([], [3000]), "grafana", "el 3000 sin saber el programa: Grafana");
eq(id(["grafana"], [3000]), "grafana", "Grafana");
eq(id(["java"], [9200]), "elasticsearch", "Elasticsearch corre en Java");
eq(id(["adminer"], [8080]), "adminer", "contenedor llamado adminer");
eq(id(["mi-app"], [8080]), "web", "puerto web habitual");
eq(id(["mi-app"], [7777]), null, "desconocido");
eq(id([], [15432, 5432]), "postgres", "contenedor 15432→5432: por el puerto de dentro");
eq(id(["sshd"], [8080]), "ssh", "túnel remoto de SSH (sshd): del sistema");
eq(id(["php-fpm8.2"], [9000]), "php-fpm", "PHP-FPM no es una web");
eq(id(["Xvnc"], [5901]), "vnc", "VNC");
eq(id([], [9100]), "node-exporter", "9100 sin programa: Node exporter");
eq(id(["kafka"], [9092]), "kafka", "Kafka");
eq(identifyService(["grafana"], [3000])?.category, "monitor", "Grafana es monitoreo");
eq(identifyService(["redis-server"], [6379])?.category, "cache", "Redis es caché");

// ── Juntar `ss`, contenedores y quitar lo del sistema ──
const ss = [
  "@@tool",
  "ss",
  "@@listen",
  'tcp   LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))',
  'tcp   LISTEN 0 128 [::]:22 [::]:* users:(("sshd",pid=1,fd=4))',
  'tcp   LISTEN 0 244 127.0.0.1:5432 0.0.0.0:* users:(("postgres",pid=10,fd=6))',
  'tcp   LISTEN 0 244 [::1]:5432 [::]:* users:(("postgres",pid=10,fd=5))',
  "tcp   LISTEN 0 511 127.0.0.53%lo:53 0.0.0.0:*",
  'tcp   LISTEN 0 4096 127.0.0.1:8081 0.0.0.0:* users:(("docker-proxy",pid=30,fd=4))',
  "tcp   LISTEN 0 4096 *:7777 *:*",
  "tcp   LISTEN 0 4096 0.0.0.0:2222 0.0.0.0:*",
  'udp   UNCONN 0 0 0.0.0.0:5353 0.0.0.0:* users:(("avahi",pid=40,fd=12))',
  "@@procs",
  "@@ctr",
  "@@end",
].join("\n");
const ctr = parseContainerPublish(
  [
    "@@cports",
    "adminer|127.0.0.1:8081->8080/tcp",
    "redis|127.0.0.1:6379->6379/tcp, 6380/tcp",
    "web|0.0.0.0:8000-8001->80-81/tcp, :::8000-8001->80-81/tcp",
    "@@end",
  ].join("\n"),
);
eq(
  ctr.map((c) => `${c.container} ${c.hostIp}:${c.hostPort}->${c.containerPort}`),
  ["adminer 127.0.0.1:8081->8080", "redis 127.0.0.1:6379->6379", "web :8000->80", "web :8001->81"],
  "puertos publicados (rangos y sin los no publicados)",
);

const found = findServices(parsePorts(ss).ports, ctr, 2222);
eq(
  found.map((s) => `${s.service?.id ?? "?"} ${s.key} ${s.scope}`),
  [
    "postgres 127.0.0.1:5432 local",
    "redis 127.0.0.1:6379 local",
    "adminer 127.0.0.1:8081 local",
    "web 127.0.0.1:8000 public",
    "? 127.0.0.1:7777 public",
    "? 127.0.0.1:8001 public",
  ],
  "servicios: reconocidos primero, los locales antes, sin SSH (22 y el de la conexión), DNS ni UDP",
);
eq(found[0].procs, ["postgres"], "IPv4 e IPv6 del mismo puerto se juntan");
eq(found[2].procs, [], "docker-proxy no cuenta como programa");
eq(found[2].container, "adminer", "el contenedor sale del puerto publicado");

// ── Categorías y adivinar «web» ──
eq(
  groupByCategory(found).map((g) => `${g.category.id}:${g.items.length}`),
  ["db:1", "web:2", "cache:1", "other:2"],
  "agrupados por categoría, en orden",
);
const script = httpProbeScript(found) ?? "";
eq(script.includes("http://127.0.0.1:7777/") && script.includes("https://127.0.0.1:8001/"), true, "prueba solo los no reconocidos");
eq(script.includes(":5432/"), false, "no prueba los reconocidos");
eq(httpProbeScript(found.filter((s) => s.service)), null, "nada que probar");
eq(
  httpProbeScript([{ ...found[4], service: null, destHost: "::1", key: "::1:7777" }])?.includes("http://[::1]:7777/"),
  true,
  "IPv6 entre corchetes",
);
eq(httpProbeScript([{ ...found[4], destHost: "a;rm -rf /", key: "x" }]), null, "solo direcciones IP en el comando");
const web = parseHttpProbe(
  [
    "@@http",
    "127.0.0.1:7777 200 000",
    "127.0.0.1:8001 400 302",
    "127.0.0.1:9999 000 000",
    "127.0.0.1:9998 404 000",
    "@@end",
  ].join("\n"),
);
eq(
  [...web],
  [["127.0.0.1:7777", "http"], ["127.0.0.1:8001", "https"], ["127.0.0.1:9998", "http"]],
  "http, https (si responde) y sin respuesta",
);
const guessed = applyHttpProbe(found, web);
eq(guessed[4].service?.category, "web", "el 7777 responde: Web");
eq(serviceTitle(guessed[4]), "Web en el puerto 7777", "título del adivinado");
eq(browserUrl(guessed[5].service, 8001, 8001), "https://localhost:8001/", "abre con https");
eq(guessed[0], found[0], "los reconocidos no cambian");
eq(groupByCategory(guessed).map((g) => g.category.id), ["db", "web", "cache"], "sin «Otro» si todos responden");

// ── Cómo se usa en tu PC ──
const pg = identifyService(["postgres"], [5432]);
eq(connectionString(pg, 5433), "postgresql://usuario@localhost:5433/", "cadena de PostgreSQL sin contraseña");
eq(connectionString(identifyService([], [8080]), 8080), null, "una web no tiene cadena");
eq(browserUrl(identifyService([], [8080]), 8080, 18080), "http://localhost:18080/", "web por http");
eq(browserUrl(identifyService(["portainer"], [9443]), 9443, 9443), "https://localhost:9443/", "puerto https");
eq(browserUrl(pg, 5432, 5432), null, "PostgreSQL no se abre en el navegador");
eq(wantedLocalPort(80), 8080, "puertos bajos: +8000");
eq(wantedLocalPort(5432), 5432, "el mismo puerto");

// ── Túnel ya guardado ──
const def: TunnelDef = {
  id: "t1",
  profileId: "p",
  name: "db",
  kind: "local",
  bindHost: "127.0.0.1",
  bindPort: 15432,
  destHost: "localhost",
  destPort: 5432,
  autoStart: false,
};
eq(findLocalTunnel([def], "127.0.0.1", 5432)?.id, "t1", "localhost = 127.0.0.1");
eq(findLocalTunnel([{ ...def, kind: "remote" }], "127.0.0.1", 5432), undefined, "solo túneles locales");

console.log(`detect: ${passed} pruebas correctas`);
