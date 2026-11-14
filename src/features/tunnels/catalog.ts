// Catálogo de servicios que se pueden traer a tu PC con un túnel: cómo reconocerlos (proceso, nombre del
// contenedor o puerto) y cómo se usan (cadena de conexión o navegador). Solo datos; la lógica está en detect.ts.

import type { ServiceCategory } from "./categories";

export interface ServiceDef {
  id: string;
  name: string;
  /** Qué tipo de servicio es (base de datos, web…): agrupa la lista y dice para qué sirve traerlo. */
  category: ServiceCategory;
  /** Puertos habituales. */
  ports: number[];
  /** Nombre del proceso o del contenedor. */
  match?: RegExp;
  /**
   * Si se sabe el programa y no coincide con `match`, no adivinar por el puerto (p. ej. el 3000 de una app
   * Node no es Grafana). Las bases de datos no lo llevan: su puerto casi siempre es suyo.
   */
  strict?: boolean;
  /** Último recurso: solo si ningún servicio concreto encaja. */
  generic?: boolean;
  /** Cadena de conexión para copiar ({port} = puerto en tu PC). Sin contraseñas. */
  conn?: string;
  /** Se abre en el navegador con este esquema (los puertos de HTTPS_PORTS van siempre con https). */
  web?: "http" | "https";
  /** Con qué se abre. */
  apps?: string;
  /** No se ofrece (es del propio sistema o no sirve para nada desde tu PC). */
  hidden?: boolean;
}

/**
 * Lo que responde por HTTP en un puerto que no se reconoce (ver probe.ts): se trata como una web. El
 * título dice el puerto (ver serviceTitle).
 */
export const WEB_GUESS: Record<"http" | "https", ServiceDef> = {
  http: { id: "web-guess", name: "Página web", category: "web", ports: [], web: "http" },
  https: { id: "web-guess", name: "Página web", category: "web", ports: [], web: "https" },
};

/** Puertos que casi siempre son HTTPS. */
export const HTTPS_PORTS = [443, 8443, 9443];

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Orden = prioridad cuando hay empate. */
export const SERVICE_CATALOG: ServiceDef[] = [
  // Bases de datos, cachés, colas y búsqueda
  {
    id: "postgres",
    name: "PostgreSQL",
    category: "db",
    ports: [5432],
    match: /postgres|postgis|timescale/i,
    conn: "postgresql://usuario@localhost:{port}/",
    apps: "DBeaver, pgAdmin o psql",
  },
  {
    id: "mysql",
    name: "MySQL / MariaDB",
    category: "db",
    ports: [3306],
    match: /mysql|mariadb/i,
    conn: "mysql://usuario@localhost:{port}/",
    apps: "DBeaver, MySQL Workbench o HeidiSQL",
  },
  {
    id: "redis",
    name: "Redis",
    category: "cache",
    ports: [6379],
    match: /redis|valkey|keydb/i,
    conn: "redis://localhost:{port}",
    apps: "RedisInsight o redis-cli",
  },
  {
    id: "mongodb",
    name: "MongoDB",
    category: "db",
    ports: [27017],
    match: /mongo/i,
    conn: "mongodb://localhost:{port}/",
    apps: "MongoDB Compass",
  },
  {
    id: "elasticsearch",
    name: "Elasticsearch",
    category: "search",
    ports: [9200],
    match: /elastic|opensearch/i,
    conn: "http://localhost:{port}",
    web: "http",
    apps: "el navegador, Kibana o curl",
  },
  {
    id: "clickhouse",
    name: "ClickHouse",
    category: "db",
    ports: [8123],
    match: /clickhouse/i,
    conn: "http://localhost:{port}",
    web: "http",
    apps: "DBeaver o el navegador",
  },
  {
    id: "rabbitmq",
    name: "RabbitMQ",
    category: "queue",
    ports: [5672],
    match: /rabbit|beam\.smp/i,
    conn: "amqp://usuario@localhost:{port}/",
    apps: "tu aplicación",
  },
  {
    id: "rabbitmq-panel",
    name: "RabbitMQ (panel)",
    category: "queue",
    ports: [15672],
    match: /rabbit|beam\.smp/i,
    web: "http",
  },
  {
    id: "memcached",
    name: "Memcached",
    category: "cache",
    ports: [11211],
    match: /memcache/i,
    conn: "localhost:{port}",
    apps: "tu aplicación",
  },
  {
    id: "kafka",
    name: "Kafka",
    category: "queue",
    ports: [9092],
    match: /kafka|redpanda/i,
    conn: "localhost:{port}",
    apps: "tu aplicación u Offset Explorer",
  },
  {
    id: "mqtt",
    name: "MQTT (Mosquitto)",
    category: "queue",
    ports: [1883],
    match: /mosquitto|emqx/i,
    conn: "mqtt://localhost:{port}",
    apps: "MQTT Explorer",
  },
  {
    id: "nats",
    name: "NATS",
    category: "queue",
    ports: [4222],
    match: /nats/i,
    conn: "nats://localhost:{port}",
    apps: "tu aplicación",
  },
  { id: "kibana", name: "Kibana", category: "search", ports: [5601], match: /kibana/i, strict: true, web: "http" },
  { id: "meilisearch", name: "Meilisearch", category: "search", ports: [7700], match: /meili/i, web: "http" },
  { id: "solr", name: "Solr", category: "search", ports: [8983], match: /solr/i, web: "http" },
  // Paneles web conocidos
  { id: "adminer", name: "Adminer", category: "web", ports: [], match: /adminer/i, web: "http" },
  { id: "phpmyadmin", name: "phpMyAdmin", category: "web", ports: [], match: /phpmyadmin/i, web: "http" },
  { id: "pgadmin", name: "pgAdmin", category: "web", ports: [], match: /pgadmin/i, web: "http" },
  { id: "cockpit", name: "Cockpit", category: "web", ports: [9090], match: /cockpit/i, strict: true, web: "https" },
  { id: "portainer", name: "Portainer", category: "web", ports: [9443], match: /portainer/i, strict: true, web: "https" },
  { id: "minio", name: "MinIO", category: "web", ports: [], match: /minio/i, web: "http" },
  // Monitoreo
  { id: "grafana", name: "Grafana", category: "monitor", ports: [3000], match: /grafana/i, strict: true, web: "http" },
  { id: "prometheus", name: "Prometheus", category: "monitor", ports: [9090], match: /prometheus/i, strict: true, web: "http" },
  { id: "netdata", name: "Netdata", category: "monitor", ports: [19999], match: /netdata/i, web: "http" },
  { id: "node-exporter", name: "Node exporter", category: "monitor", ports: [9100], match: /node.exporter/i, strict: true, web: "http" },
  { id: "uptime-kuma", name: "Uptime Kuma", category: "monitor", ports: [3001], match: /uptime-kuma|kuma/i, strict: true, web: "http" },
  // Escritorio remoto
  {
    id: "vnc",
    name: "Escritorio remoto (VNC)",
    category: "screen",
    ports: range(5900, 5909),
    match: /vnc/i,
    conn: "localhost:{port}",
    apps: "un visor VNC (TigerVNC, Remmina…)",
  },
  {
    id: "rdp",
    name: "Escritorio remoto (RDP)",
    category: "screen",
    ports: [3389],
    match: /xrdp/i,
    conn: "localhost:{port}",
    apps: "Conexión a Escritorio remoto de Windows o Remmina",
  },
  // Del propio sistema: no se ofrecen. sshd también cubre los túneles remotos (-R) que abre SSHorus.
  { id: "ssh", name: "SSH", category: "other", ports: [22], match: /^sshd/, hidden: true },
  { id: "dns", name: "DNS", category: "other", ports: [53, 5355], match: /systemd-resolve|dnsmasq|named|unbound/, hidden: true },
  { id: "mail", name: "Correo", category: "other", ports: [25, 465, 587], match: /^(master|exim4?|sendmail)$/, hidden: true },
  { id: "system", name: "Sistema", category: "other", ports: [111, 323, 631, 2049], match: /^(rpcbind|chronyd|cupsd|containerd)$/, hidden: true },
  { id: "php-fpm", name: "PHP-FPM", category: "other", ports: [], match: /php.*fpm/, hidden: true },
  // Cualquier otra web
  {
    id: "web",
    name: "Panel o app web",
    category: "web",
    ports: [80, 443, 3000, 4200, 5000, 5173, 8000, 8080, 8081, 8443, 8888, 9000],
    match: /nginx|apache2|httpd|caddy|traefik|lighttpd|node|deno|bun|gunicorn|uvicorn|puma|php/i,
    generic: true,
    web: "http",
  },
];

/**
 * Procesos que solo reenvían el puerto de un contenedor (o lo abren por systemd): su nombre no dice qué
 * servicio es, así que se mira el contenedor y el puerto.
 */
export const PROXY_PROCESSES = /^(docker-proxy|rootlessport|rootlessport-child|conmon|pasta|pasta\.avx2|slirp4netns|systemd)$/;
