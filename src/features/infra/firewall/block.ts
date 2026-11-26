// Cortafuegos: bloquear un solo puerto (lo usa «Cerrar puerto»). Se añade una regla que rechaza las
// conexiones nuevas a ese puerto y se aplica a prueba, como los demás cambios (se deshace sola si no se
// confirma). firewalld: regla enriquecida «reject» en las zonas que miran hacia fuera (firewalld mira los
// rechazos antes que los servicios y puertos abiertos); ufw: «deny» al principio de la lista (en ufw manda
// la primera regla que encaja). Funciones puras.
import { fwd, ufwCmd, UFW_RESTORE, UFW_SAVE, type FwPlan } from "./commands";
import { usedZones } from "./firewalld";
import { reach } from "./reach";
import type { FwReport } from "./types";

/** Interfaces internas (la propia máquina, puentes de contenedores y máquinas virtuales). */
const INNER_IFACE = /^(lo|docker\d*|podman\d*|cni[-\d]|br-|veth|virbr|flannel|cali|vxlan)/;

/** Zonas de firewalld en uso por las que se entra desde fuera (la de por defecto siempre). */
export function outsideZones(report: Pick<FwReport, "zones">): string[] {
  return usedZones(report.zones)
    .filter((z) => z.isDefault || z.sources.length > 0 || z.interfaces.some((i) => !INNER_IFACE.test(i)))
    .map((z) => z.name);
}

/** Regla enriquecida que rechaza las conexiones nuevas al puerto (IPv4 e IPv6). */
export function blockRichRule(port: number, proto: "tcp" | "udp"): string {
  return `rule port port="${port}" protocol="${proto}" reject`;
}

export type BlockCheck = { kind: "plan"; plan: FwPlan } | { kind: "already"; text: string } | { kind: "error"; text: string };

/**
 * Cómo bloquear `port/proto` en el cortafuegos, o por qué no se puede. `sshPorts`: los puertos de SSH
 * (el de esta conexión primero): nunca se bloquean.
 */
export function blockPort(report: FwReport, port: number, proto: "tcp" | "udp", sshPorts: number[]): BlockCheck {
  if (proto === "tcp" && sshPorts.includes(port)) {
    return { kind: "error", text: `El puerto ${port} es el de SSH, por donde entra SSHorus: si lo bloqueas te quedas fuera del servidor.` };
  }
  if (!report.tool) return { kind: "error", text: "El servidor no tiene cortafuegos (firewalld ni ufw)." };
  if (!report.readable) return { kind: "error", text: "Para leer y cambiar el cortafuegos hace falta sudo." };
  if (report.tool !== "firewalld" && report.tool !== "ufw") {
    return { kind: "error", text: `SSHorus solo cambia firewalld y ufw: las reglas de ${report.tool} se cambian a mano.` };
  }
  if (!report.active) return { kind: "error", text: `El cortafuegos (${report.tool}) está apagado. Actívalo antes desde el mapa (nodo «Cortafuegos»).` };
  if (reach(report, { port, proto }) === "blocked") return { kind: "already", text: "El cortafuegos ya no deja llegar a este puerto desde fuera." };
  const title = `Bloquear ${proto.toUpperCase()} ${port}`;
  if (report.tool === "ufw") {
    const spec = ["prepend", "deny", `${port}/${proto}`];
    // Deshacerlo deja las reglas como estaban (un `ufw delete deny …` quitaría también una igual que ya hubiera).
    return { kind: "plan", plan: { tool: "ufw", title, apply: [UFW_SAVE, ufwCmd(spec)], revert: [UFW_RESTORE], permanent: [], trial: true, checkLogin: true } };
  }
  const rule = blockRichRule(port, proto);
  const zones = outsideZones(report).filter((z) => !report.zones.find((x) => x.name === z)?.richRules.includes(rule));
  if (zones.length === 0) return { kind: "error", text: "No se sabe en qué zona de firewalld bloquearlo." };
  const plan: FwPlan = {
    tool: "firewalld",
    title: `${title} (zona ${zones.map((z) => `«${z}»`).join(", ")})`,
    apply: zones.map((z) => fwd(z, "add", "rich-rule", rule)),
    revert: zones.map((z) => fwd(z, "remove", "rich-rule", rule)),
    permanent: zones.map((z) => fwd(z, "add", "rich-rule", rule, true)),
    trial: true,
    checkLogin: true,
    ...(zones.length === 1 ? { alreadyIf: fwd(zones[0], "query", "rich-rule", rule) } : {}),
  };
  return { kind: "plan", plan };
}
