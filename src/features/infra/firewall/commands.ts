// Cortafuegos: de un cambio (abrir, quitar, activar) a los comandos exactos de firewalld o ufw, y los
// scripts que los aplican «a prueba» (se deshacen solos si no se confirman a tiempo). Funciones puras.
import { shQuote, shQuoteMinimal as q } from "../../../lib/remote";
import { ruleText } from "./explain";
import type { FwRef, FwReport, FwRule, PortRange } from "./types";

export type FwTarget =
  | { kind: "port"; ports: PortRange; proto: "tcp" | "udp"; source: string | null }
  | { kind: "service"; name: string; source: string | null };

export type FwChange =
  | { kind: "add"; target: FwTarget; zone: string | null }
  | { kind: "remove"; rule: FwRule }
  | { kind: "enable"; sshPorts: number[] };

export interface FwPlan {
  tool: "firewalld" | "ufw";
  title: string;
  /** Lo que se ejecuta ahora (se enseña antes de confirmar). */
  apply: string[];
  /** Lo que lo deshace. */
  revert: string[];
  /** Para dejarlo fijo al confirmar (firewalld: lo mismo con --permanent). */
  permanent: string[];
  /** Se aplica a prueba: si no se confirma en TRIAL_SECS, se deshace solo en el servidor. */
  trial: boolean;
  /** Después se prueba a abrir una conexión SSH nueva (si falla, se deshace enseguida). */
  checkLogin: boolean;
}

/** Tiempo para confirmar un cambio a prueba. */
export const TRIAL_SECS = 300;

const PATH_LINE = "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin";

function rangeText(r: PortRange, sep: string): string {
  return r.from === r.to ? `${r.from}` : `${r.from}${sep}${r.to}`;
}

// ───────── firewalld ─────────

type FwdKind = "port" | "service" | "rich-rule" | "forward-port" | "masquerade";

function fwd(zone: string, op: "add" | "remove", kind: FwdKind, value: string, permanent = false): string {
  const v = kind === "masquerade" ? "" : `=${q(value)}`;
  return `firewall-cmd${permanent ? " --permanent" : ""} --zone=${q(zone)} --${op}-${kind}${v}`;
}

/** Regla enriquecida para abrir algo solo a un origen. */
export function richRuleFor(t: FwTarget & { source: string }): string {
  const family = t.source.includes(":") ? "ipv6" : "ipv4";
  const what = t.kind === "port" ? `port port="${rangeText(t.ports, "-")}" protocol="${t.proto}"` : `service name="${t.name}"`;
  return `rule family="${family}" source address="${t.source}" ${what} accept`;
}

function fwdTarget(t: FwTarget): { kind: FwdKind; value: string } {
  if (t.source) return { kind: "rich-rule", value: richRuleFor({ ...t, source: t.source }) };
  return t.kind === "port" ? { kind: "port", value: `${rangeText(t.ports, "-")}/${t.proto}` } : { kind: "service", value: t.name };
}

const REF_KIND: Record<string, FwdKind> = { port: "port", service: "service", rich: "rich-rule", forward: "forward-port", masquerade: "masquerade" };

/** Cambio de firewalld: ahora en runtime (se pierde al recargar) y, al confirmar, con --permanent. */
function fwdPlan(title: string, zone: string, op: "add" | "remove", kind: FwdKind, value: string, checkLogin: boolean): FwPlan {
  const undo = op === "add" ? "remove" : "add";
  return {
    tool: "firewalld",
    title,
    apply: [fwd(zone, op, kind, value)],
    revert: [fwd(zone, undo, kind, value)],
    permanent: [fwd(zone, op, kind, value, true)],
    trial: true,
    checkLogin,
  };
}

// ───────── ufw ─────────

function ufwCmd(spec: string[], del = false): string {
  return `ufw ${del ? "delete " : ""}${spec.map(q).join(" ")}`;
}

/** Argumentos de `ufw` para abrir algo. */
export function ufwTargetSpec(t: FwTarget): string[] {
  if (t.kind === "service") return t.source ? ["allow", "from", t.source, "to", "any", "app", t.name] : ["allow", t.name];
  const ports = rangeText(t.ports, ":");
  return t.source ? ["allow", "from", t.source, "to", "any", "port", ports, "proto", t.proto] : ["allow", `${ports}/${t.proto}`];
}

// ───────── Plan ─────────

function targetTitle(t: FwTarget): string {
  const what = t.kind === "port" ? `${t.proto.toUpperCase()} ${rangeText(t.ports, "-")}` : `el servicio «${t.name}»`;
  return `Abrir ${what}${t.source ? ` solo a ${t.source}` : ""}`;
}

/** Zona donde abrir: la pedida, la de la interfaz de esta conexión o la de por defecto. */
export function zoneForChange(report: FwReport, wanted: string | null, serverIp: string | null): string | null {
  if (wanted) return wanted;
  const iface = serverIp ? report.ifaces.find((i) => i.ip === serverIp)?.iface : undefined;
  const byIface = iface ? report.zones.find((z) => z.interfaces.includes(iface)) : undefined;
  return byIface?.name ?? report.defaultZone;
}

/** Los comandos del cambio, o el motivo por el que SSHorus no puede hacerlo. */
export function planChange(report: FwReport, change: FwChange, serverIp: string | null = null): FwPlan | { error: string } {
  const tool = report.tool;
  if (tool !== "firewalld" && tool !== "ufw") return { error: "Por ahora SSHorus solo cambia reglas de firewalld y ufw: las de nftables e iptables se ven, pero se cambian a mano." };
  if (change.kind === "enable") return enablePlan(tool, change.sshPorts, report.defaultZone);
  if (change.kind === "add") {
    if (tool === "ufw") {
      const spec = ufwTargetSpec(change.target);
      // Abrir algo no puede dejarte fuera: se aplica sin prueba.
      return { tool, title: targetTitle(change.target), apply: [ufwCmd(spec)], revert: [ufwCmd(spec, true)], permanent: [], trial: false, checkLogin: false };
    }
    const zone = zoneForChange(report, change.zone, serverIp);
    if (!zone) return { error: "No se sabe en qué zona de firewalld abrirlo." };
    const t = fwdTarget(change.target);
    return fwdPlan(`${targetTitle(change.target)} (zona «${zone}»)`, zone, "add", t.kind, t.value, false);
  }
  const rule = change.rule;
  if (rule.managedBy) return { error: "Esta regla la creó Docker o Podman: se rehace sola, no la toques a mano." };
  const ref: FwRef | null = rule.ref;
  if (!ref) return { error: "SSHorus no sabe quitar esta regla: quítala a mano desde la terminal." };
  const title = `Quitar: ${ruleText(rule, report)}`;
  if (ref.tool === "ufw") return { tool: "ufw", title, apply: [ufwCmd(ref.spec, true)], revert: [ufwCmd(ref.spec)], permanent: [], trial: true, checkLogin: true };
  return fwdPlan(title, ref.zone, "remove", REF_KIND[ref.kind], ref.value, true);
}

function enablePlan(tool: "firewalld" | "ufw", sshPorts: number[], zone: string | null): FwPlan {
  if (tool === "ufw") {
    return {
      tool,
      title: "Activar ufw",
      apply: [...sshPorts.map((p) => ufwCmd(["allow", `${p}/tcp`])), "ufw --force enable"],
      revert: ["ufw disable"],
      permanent: [],
      trial: true,
      checkLogin: true,
    };
  }
  const z = zone ? ` --zone=${q(zone)}` : "";
  return {
    tool,
    title: "Activar firewalld",
    // Con firewalld parado se usa firewall-offline-cmd: el puerto de SSH queda abierto antes de arrancarlo.
    apply: [...sshPorts.map((p) => `firewall-offline-cmd${z} --add-port=${p}/tcp`), "systemctl enable --now firewalld"],
    revert: ["systemctl disable --now firewalld"],
    permanent: [],
    trial: true,
    checkLogin: true,
  };
}

// ───────── Scripts ─────────

function marker(tag: string): string {
  return `/run/sshorus-fw-${tag.replace(/[^A-Za-z0-9-]/g, "")}`;
}

/** Sin prueba: se ejecutan uno tras otro y se para en el primero que falle. */
export function directScript(plan: FwPlan): string {
  return [PATH_LINE, plan.apply.join(" && ")].join("\n");
}

/**
 * A prueba: primero se arma en el servidor la vuelta atrás (un proceso aparte que espera `secs` y lo
 * deshace si la marca sigue ahí), después se aplica. Así, aunque el cambio corte la conexión, se deshace
 * solo. Si un comando falla, se deshace enseguida.
 */
export function trialScript(plan: FwPlan, tag: string, secs = TRIAL_SECS): string {
  const m = marker(tag);
  const revert = plan.revert.join("; ");
  const later = `sleep ${secs}; [ -e ${m} ] || exit 0; rm -f ${m}; ${revert}`;
  return [
    PATH_LINE,
    `M=${m}`,
    `touch "$M" || exit 1`,
    `REV=${shQuote(later)}`,
    `if command -v setsid >/dev/null 2>&1; then setsid sh -c "$REV" >/dev/null 2>&1 </dev/null & else nohup sh -c "$REV" >/dev/null 2>&1 </dev/null & fi`,
    `{ ${plan.apply.join(" && ")}; } || { echo 'Falló: se deshace el cambio' >&2; rm -f "$M"; ${revert}; exit 1; }`,
  ].join("\n");
}

/** «Confirmar»: quita la vuelta atrás y, en firewalld, lo deja fijo. Falla (3) si ya se deshizo solo. */
export function confirmScript(plan: FwPlan, tag: string): string {
  const fix = plan.permanent.length ? ` && ${plan.permanent.join(" && ")}` : "";
  return [
    PATH_LINE,
    `M=${marker(tag)}`,
    `if [ -e "$M" ]; then rm -f "$M"${fix}; else echo 'El cambio ya se había deshecho solo (pasó el tiempo).' >&2; exit 3; fi`,
  ].join("\n");
}

/** «Deshacer ahora» (si no se había deshecho ya solo). */
export function undoScript(plan: FwPlan, tag: string): string {
  return [PATH_LINE, `M=${marker(tag)}`, `if [ -e "$M" ]; then rm -f "$M"; ${plan.revert.join("; ")}; else echo 'Ya se había deshecho solo.'; fi`].join("\n");
}
