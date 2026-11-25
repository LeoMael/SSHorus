// Cortafuegos del mapa: tipos de lo leído (firewalld, ufw, nftables, iptables) ya entendido.

export type FwTool = "firewalld" | "ufw" | "nftables" | "iptables";

/** Qué hace la regla con lo que encaja: dejar pasar, bloquear, rechazar (avisando), limitar… */
export type FwVerdict = "allow" | "deny" | "reject" | "limit" | "jump" | "return" | "nat" | "log" | "other";

/** Tráfico que entra, que sale o que atraviesa la máquina (contenedores, router). */
export type FwDir = "in" | "out" | "forward" | "other";

export type ContainerEngine = "docker" | "podman";

export interface PortRange {
  from: number;
  to: number;
}

/** Cómo quitar la regla con su herramienta (null = no se puede desde SSHorus). */
export type FwRef =
  | { tool: "firewalld"; zone: string; kind: "port" | "service" | "rich" | "forward"; value: string }
  | { tool: "firewalld"; zone: string; kind: "masquerade"; value: "" }
  /** Argumentos tras `ufw` que crean la regla («allow 22/tcp»); `ufw delete …` la quita. */
  | { tool: "ufw"; spec: string[] };

/** Una regla, ya entendida. Lo que no se entiende deja `extra` a true (el texto avisa). */
export interface FwRule {
  id: string;
  tool: FwTool;
  dir: FwDir;
  verdict: FwVerdict;
  /** tcp, udp, icmp…; null = cualquiera. */
  proto: string | null;
  /** Vacío = todos los puertos. */
  ports: PortRange[];
  /** Servicio con nombre (firewalld) o perfil de aplicación (ufw). */
  service: string | null;
  /** Origen (IP o red); null = desde cualquier sitio. */
  source: string | null;
  /** Interfaz de entrada (lo, eth0…). */
  iface: string | null;
  /** Estados de conexión (established, related, new…). */
  states: string[];
  /** Cadena a la que salta, o destino de una redirección. */
  target: string | null;
  /** null = IPv4 e IPv6. */
  family: "ipv4" | "ipv6" | null;
  comment: string | null;
  /** Tiene condiciones que SSHorus no sabe leer. */
  extra: boolean;
  /** La crearon Docker o Podman: no se toca a mano. */
  managedBy: ContainerEngine | null;
  /** Zona (firewalld) o «tabla cadena». */
  place: string;
  /** Texto original de la regla. */
  raw: string;
  ref: FwRef | null;
}

/** Zona de firewalld. */
export interface FwZone {
  name: string;
  active: boolean;
  isDefault: boolean;
  /** default, ACCEPT, DROP, REJECT o %%REJECT%%. */
  target: string;
  interfaces: string[];
  sources: string[];
  services: string[];
  ports: string[];
  masquerade: boolean;
  forwardPorts: string[];
  richRules: string[];
}

/** Cadena de nftables o iptables. */
export interface FwChain {
  /** «inet filter», «filter» (iptables)… */
  table: string;
  name: string;
  /** input, output, forward… (null = cadena normal, solo se llega saltando). */
  hook: string | null;
  /** filter, nat, mangle… (en iptables, el nombre de la tabla). */
  type: string | null;
  /** Qué pasa con lo que no encaja en ninguna regla (solo en las cadenas con hook). */
  policy: "accept" | "drop" | null;
  rules: FwRule[];
  managedBy: ContainerEngine | null;
}

export interface UfwDefaults {
  incoming: string;
  outgoing: string;
  routed: string;
}

/** Interfaz y una de sus direcciones (`ip -o addr`). */
export interface IfaceAddr {
  iface: string;
  ip: string;
}

/** Todo lo leído del cortafuegos de un servidor. */
export interface FwReport {
  /** La herramienta que manda (null = ninguna instalada o no se pudo leer). */
  tool: FwTool | null;
  active: boolean;
  /** Herramientas instaladas, con su estado («ufw inactive»…). */
  installed: { tool: FwTool; state: string }[];
  /** Se pudieron leer las reglas (con root; firewalld a veces también deja sin él). */
  readable: boolean;
  /** Reglas de la herramienta principal (sin las de Docker/Podman). */
  rules: FwRule[];
  /** Reglas creadas por Docker/Podman (no tocar a mano). */
  managed: FwRule[];
  zones: FwZone[];
  defaultZone: string | null;
  /** Puertos de cada servicio de firewalld usado («ssh» → 22/tcp). */
  services: Record<string, { proto: string; ports: PortRange[] }[]>;
  ufwDefaults: UfwDefaults | null;
  /** Reglas guardadas de ufw aunque esté apagado (`ufw show added`). */
  ufwAdded: FwRule[];
  chains: FwChain[];
  ifaces: IfaceAddr[];
  notes: string[];
}

/** Conexión SSH actual vista desde el servidor ($SSH_CONNECTION). */
export interface SshConn {
  clientIp: string;
  serverIp: string;
  serverPort: number;
}
