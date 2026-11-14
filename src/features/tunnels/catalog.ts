// Catálogo de servicios que se pueden traer a tu PC con un túnel: cómo reconocerlos (proceso, nombre del
// contenedor o puerto) y cómo se usan (cadena de conexión o navegador). Solo datos; la lógica está en detect.ts.

export type ServiceKind = "db" | "web" | "screen" | "other";
/** Icono (la interfaz lo traduce a uno de lucide). */
export type ServiceIcon = "database" | "cache" | "search" | "queue" | "chart" | "web" | "screen" | "box" | "plug";

export interface ServiceDef {
  id: string;
  name: string;
  icon: ServiceIcon;
  kind: ServiceKind;
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

/** Puertos que casi siempre son HTTPS. */
export const HTTPS_PORTS = [443, 8443, 9443];

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Orden = prioridad cuando hay empate. */
export const SERVICE_CATALOG: ServiceDef[] = [
  // Bases de datos y colas
  {
    id: "postgres",
    name: "PostgreSQL",
    icon: "database",
    kind: "db",
    ports: [5432],
    match: /postgres|postgis|timescale/i,
    conn: "postgresql://usuario@localhost:{port}/",
    apps: "DBeaver, pgAdmin o psql",
  },
  {
    id: "mysql",
    name: "MySQL / MariaDB",
    icon: "database",
    kind: "db",
    ports: [3306],
    match: /mysql|mariadb/i,
    conn: "mysql://usuario@localhost:{port}/",
    apps: "DBeaver, MySQL Workbench o HeidiSQL",
  },
  {
    id: "redis",
    name: "Redis",
    icon: "cache",
    kind: "db",
    ports: [6379],
    match: /redis|valkey|keydb/i,
    conn: "redis://localhost:{port}",
    apps: "RedisInsight o redis-cli",
  },
  {
    id: "mongodb",
    name: "MongoDB",
    icon: "database",
    kind: "db",
    ports: [27017],
    match: /mongo/i,
    conn: "mongodb://localhost:{port}/",
    apps: "MongoDB Compass",
  },
  {
    id: "elasticsearch",
    name: "Elasticsearch",
    icon: "search",
    kind: "db",
    ports: [9200],
    match: /elastic|opensearch/i,
    conn: "http://localhost:{port}",
    web: "http",
    apps: "el navegador, Kibana o curl",
  },
  {
    id: "clickhouse",
    name: "ClickHouse",
    icon: "database",
    kind: "db",
    ports: [8123],
    match: /clickhouse/i,
    conn: "http://localhost:{port}",
    web: "http",
    apps: "DBeaver o el navegador",
  },
  {
    id: "rabbitmq",
    name: "RabbitMQ",
    icon: "queue",
    kind: "db",
    ports: [5672],
    match: /rabbit|beam\.smp/i,
    conn: "amqp://usuario@localhost:{port}/",
    apps: "tu aplicación",
  },
  {
    id: "rabbitmq-panel",
    name: "RabbitMQ (panel)",
    icon: "queue",
    kind: "web",
    ports: [15672],
    match: /rabbit|beam\.smp/i,
    web: "http",
  },
  {
    id: "memcached",
    name: "Memcached",
    icon: "cache",
    kind: "db",
    ports: [11211],
    match: /memcache/i,
    conn: "localhost:{port}",
    apps: "tu aplicación",
  },
  // Paneles web conocidos
  { id: "adminer", name: "Adminer", icon: "web", kind: "web", ports: [], match: /adminer/i, web: "http" },
  { id: "phpmyadmin", name: "phpMyAdmin", icon: "web", kind: "web", ports: [], match: /phpmyadmin/i, web: "http" },
  { id: "pgadmin", name: "pgAdmin", icon: "web", kind: "web", ports: [], match: /pgadmin/i, web: "http" },
  { id: "grafana", name: "Grafana", icon: "chart", kind: "web", ports: [3000], match: /grafana/i, strict: true, web: "http" },
  { id: "cockpit", name: "Cockpit", icon: "web", kind: "web", ports: [9090], match: /cockpit/i, strict: true, web: "https" },
  { id: "prometheus", name: "Prometheus", icon: "chart", kind: "web", ports: [9090], match: /prometheus/i, strict: true, web: "http" },
  { id: "portainer", name: "Portainer", icon: "box", kind: "web", ports: [9443], match: /portainer/i, strict: true, web: "https" },
  { id: "minio", name: "MinIO", icon: "box", kind: "web", ports: [], match: /minio/i, web: "http" },
  // Escritorio remoto
  {
    id: "vnc",
    name: "Escritorio remoto (VNC)",
    icon: "screen",
    kind: "screen",
    ports: range(5900, 5909),
    match: /vnc/i,
    conn: "localhost:{port}",
    apps: "un visor VNC (TigerVNC, Remmina…)",
  },
  // Del propio sistema: no se ofrecen. sshd también cubre los túneles remotos (-R) que abre SSHorus.
  { id: "ssh", name: "SSH", icon: "plug", kind: "other", ports: [22], match: /^sshd/, hidden: true },
  { id: "dns", name: "DNS", icon: "plug", kind: "other", ports: [53, 5355], match: /systemd-resolve|dnsmasq|named|unbound/, hidden: true },
  { id: "mail", name: "Correo", icon: "plug", kind: "other", ports: [25, 465, 587], match: /^(master|exim4?|sendmail)$/, hidden: true },
  { id: "system", name: "Sistema", icon: "plug", kind: "other", ports: [111, 323, 631, 2049], match: /^(rpcbind|chronyd|cupsd|containerd)$/, hidden: true },
  { id: "php-fpm", name: "PHP-FPM", icon: "plug", kind: "other", ports: [], match: /php.*fpm/, hidden: true },
  // Cualquier otra web
  {
    id: "web",
    name: "Panel o app web",
    icon: "web",
    kind: "web",
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
