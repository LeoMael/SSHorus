// sysctl de red (y dos del kernel): qué valor tiene cada uno, cuál se recomienda y por qué, y un archivo
// en /etc/sysctl.d para dejar los recomendados. Las claves y valores salen de esta tabla, nunca del
// servidor. Funciones puras.
import { shJoin } from "../../lib/remote";
import { change, row, type ConfigChange, type ConfigRow } from "./model";

export interface SysctlKey {
  key: string;
  /** Valores que se dan por buenos (el primero es el que se pone). null = solo se informa. */
  good: string[] | null;
  what: string;
}

export const SYSCTL_KEYS: SysctlKey[] = [
  { key: "net.ipv4.ip_forward", good: null, what: "Reenviar paquetes entre redes. Lo necesitan los contenedores con red propia, las VPN y los routers" },
  { key: "net.ipv4.tcp_syncookies", good: ["1"], what: "Aguanta ataques de inundación SYN sin quedarse sin conexiones" },
  { key: "net.ipv4.conf.all.rp_filter", good: ["1", "2"], what: "Descarta paquetes con dirección de origen falsificada" },
  { key: "net.ipv4.conf.all.accept_redirects", good: ["0"], what: "No hacer caso a «redirecciones» ICMP (pueden desviar tu tráfico)" },
  { key: "net.ipv4.conf.default.accept_redirects", good: ["0"], what: "Lo mismo para las interfaces nuevas" },
  { key: "net.ipv6.conf.all.accept_redirects", good: ["0"], what: "Lo mismo en IPv6" },
  { key: "net.ipv4.conf.all.send_redirects", good: ["0"], what: "No mandar redirecciones (solo lo hace un router)" },
  { key: "net.ipv4.conf.all.accept_source_route", good: ["0"], what: "No aceptar paquetes que eligen su propia ruta" },
  { key: "net.ipv4.icmp_echo_ignore_broadcasts", good: ["1"], what: "No responder a pings a toda la red (ataques «smurf»)" },
  { key: "net.ipv4.conf.all.log_martians", good: ["1"], what: "Apuntar en el registro los paquetes imposibles" },
  { key: "kernel.dmesg_restrict", good: ["1"], what: "Solo root lee los mensajes del kernel (dmesg)" },
  { key: "kernel.kptr_restrict", good: ["1", "2"], what: "Oculta direcciones de memoria del kernel (dificulta exploits)" },
];

export const SYSCTL_FILE = "/etc/sysctl.d/90-sshorus-red.conf";

/** «clave=valor» → mapa (los tabuladores ya vienen como espacios). */
export function parseSysctl(ls: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of ls) {
    const i = l.indexOf("=");
    if (i > 0) out.set(l.slice(0, i).trim(), l.slice(i + 1).trim());
  }
  return out;
}

/** «/etc/sysctl.d/x.conf:clave = valor» → clave: archivo (el último que la fija gana). */
export function parseSysFiles(ls: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of ls) {
    const m = /^([^:]+):\s*([a-z0-9_.]+)\s*=/.exec(l);
    if (m) out.set(m[2], m[1]);
  }
  return out;
}

export function sysctlRows(vals: Map<string, string>, files: Map<string, string>): ConfigRow[] {
  return SYSCTL_KEYS.filter((k) => vals.has(k.key)).map((k) => {
    const v = vals.get(k.key) ?? "";
    const where = files.get(k.key);
    const okv = k.good === null || k.good.includes(v);
    return row({
      id: k.key,
      title: `${k.key} = ${v}`,
      detail: `${k.what}.${k.good && !okv ? ` Se recomienda ${k.good.join(" o ")}.` : ""}${where ? ` Fijado en ${where}.` : ""}`,
      status: k.good === null ? "info" : okv ? "ok" : "warn",
    });
  });
}

/** Lo que no está como se recomienda (solo las claves que existen en este kernel). */
export function sysctlPending(vals: Map<string, string>): SysctlKey[] {
  return SYSCTL_KEYS.filter((k) => k.good !== null && vals.has(k.key) && !k.good.includes(vals.get(k.key) ?? ""));
}

export function sysctlChange(pending: SysctlKey[]): ConfigChange | null {
  if (!pending.length) return null;
  const lines = ["# Añadido por SSHorus (Administración → Configuración): red más segura", ...pending.map((k) => `${k.key} = ${k.good![0]}`)];
  return change({
    id: "sysctl.apply",
    label: `Aplicar los ${pending.length} recomendados`,
    title: "Red: aplicar los valores recomendados de sysctl",
    explain: `Escribe ${SYSCTL_FILE} con ${pending.map((k) => k.key).join(", ")} y lo aplica ya (se mantiene al reiniciar).`,
    steps: [`printf '%s\\n' ${shJoin(lines)} > ${SYSCTL_FILE}`, `sysctl -p ${SYSCTL_FILE}`],
    note: "Si un archivo posterior (p. ej. 99-sysctl.conf) fija la misma clave, ganará ese",
  });
}
