// Cortafuegos: de un cambio (abrir, quitar, activar) a los comandos exactos de firewalld o ufw, y los
// scripts que los aplican «a prueba» (se deshacen solos si no se confirman a tiempo). Funciones puras.
import { shQuote, shQuoteMinimal as q } from "../../../lib/remote";
import { ruleText } from "./explain";
import type { FwRef, FwReport, FwRule, FwZone, PortRange } from "./types";

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
  /** Si este comando sale bien, ya estaba así: no se toca nada (deshacerlo quitaría lo que ya había). */
  alreadyIf?: string;
}

/** Tiempo para confirmar un cambio a prueba. */
export const TRIAL_SECS = 300;

const PATH_LINE = "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin";

function rangeText(r: PortRange, sep: string): string {
  return r.from === r.to ? `${r.from}` : `${r.from}${sep}${r.to}`;
}

// ───────── firewalld ─────────

type FwdKind = "port" | "service" | "rich-rule" | "forward-port" | "masquerade";

export function fwd(zone: string, op: "add" | "remove" | "query", kind: FwdKind, value: string, permanent = false): string {
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
    ...(op === "add" ? { alreadyIf: fwd(zone, "query", kind, value) } : {}),
  };
}

/** «22/tcp» u «8000-8010/udp» de una zona. */
function zonePort(s: string): { range: PortRange; proto: string } | null {
  const m = /^(\d+)(?:-(\d+))?\/(\w+)$/.exec(s);
  return m ? { range: { from: Number(m[1]), to: Number(m[2] ?? m[1]) }, proto: m[3] } : null;
}

/**
 * Lo que se quiere abrir ya está en la zona (o se solapa con un rango abierto). firewalld da por bueno el
 * «añadir» repetido y junta los rangos que se tocan, así que deshacerlo quitaría también lo que ya había
 * (p. ej. «ssh»: te quedarías fuera).
 */
function alreadyOpen(z: FwZone, t: FwTarget, v: { kind: FwdKind; value: string }): string | null {
  if (v.kind === "service" && z.services.includes(v.value)) return `el servicio «${v.value}»`;
  if (v.kind === "rich-rule" && z.richRules.includes(v.value)) return "esa misma regla";
  if (v.kind !== "port" || t.kind !== "port") return null;
  const hit = z.ports.find((p) => {
    const x = zonePort(p);
    return x !== null && x.proto === t.proto && x.range.from <= t.ports.to && t.ports.from <= x.range.to;
  });
  return hit ? `el puerto ${hit}` : null;
}

// ───────── ufw ─────────

export function ufwCmd(spec: string[], del = false): string {
  return `ufw ${del ? "delete " : ""}${spec.map(q).join(" ")}`;
}

/** Carpeta de cada cambio a prueba con la copia de lo que había (la pone cada script, ver `marker`). */
const SAVE = '"$FWSAVE"';
const UFW_FILES = ["/etc/ufw/user.rules", "/etc/ufw/user6.rules"];
/**
 * Quitar una regla de ufw a prueba: antes se copian sus reglas, y deshacerlo las deja tal cual estaban.
 * Volver a crearla con `ufw allow …` la pondría al final, y en ufw manda la primera que encaja: un «ALLOW»
 * detrás de un «DENY» ya no deja pasar (y se perdería su comentario).
 */
export const UFW_SAVE = `mkdir -p ${SAVE} && cp -p ${UFW_FILES.join(" ")} ${SAVE}/`;
export const UFW_RESTORE = `cp -p ${UFW_FILES.map((f) => `${SAVE}/${f.slice(f.lastIndexOf("/") + 1)}`).join(" ")} /etc/ufw/ && ufw reload`;

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
    const z = report.zones.find((x) => x.name === zone);
    const dup = z ? alreadyOpen(z, change.target, t) : null;
    if (dup) return { error: `En la zona «${zone}» ya está abierto ${dup}: no hace falta (y deshacerlo quitaría también lo que ya había).` };
    return fwdPlan(`${targetTitle(change.target)} (zona «${zone}»)`, zone, "add", t.kind, t.value, false);
  }
  const rule = change.rule;
  if (rule.managedBy) return { error: "Esta regla la creó Docker o Podman: se rehace sola, no la toques a mano." };
  const ref: FwRef | null = rule.ref;
  if (!ref) return { error: "SSHorus no sabe quitar esta regla: quítala a mano desde la terminal." };
  const title = `Quitar: ${ruleText(rule, report)}`;
  if (ref.tool === "ufw") return { tool: "ufw", title, apply: [UFW_SAVE, ufwCmd(ref.spec, true)], revert: [UFW_RESTORE], permanent: [], trial: true, checkLogin: true };
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

/** La marca y la carpeta de la copia (`$M`, `$FWSAVE`; también para la vuelta atrás que espera aparte). */
function vars(tag: string): string {
  const m = marker(tag);
  return `M=${m}; FWSAVE=${m}.d; export M FWSAVE`;
}

/**
 * Quitar la marca es lo que decide quién termina el cambio (deshacer solo, confirmar o deshacer ahora):
 * `rm` sin -f falla si ya no estaba, así nunca lo hacen dos a la vez.
 */
const TAKE = 'rm "$M" 2>/dev/null';

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
  const revert = `${plan.revert.join("; ")}; rm -rf ${SAVE}`;
  const later = `sleep ${secs}; ${TAKE} || exit 0; ${revert}`;
  return [
    PATH_LINE,
    vars(tag),
    ...(plan.alreadyIf ? [`if ${plan.alreadyIf} >/dev/null 2>&1; then echo 'Ya estaba así: no se cambia nada.' >&2; exit 4; fi`] : []),
    `touch "$M" || exit 1`,
    `REV=${shQuote(later)}`,
    `if command -v setsid >/dev/null 2>&1; then setsid sh -c "$REV" >/dev/null 2>&1 </dev/null & else nohup sh -c "$REV" >/dev/null 2>&1 </dev/null & fi`,
    `{ ${plan.apply.join(" && ")}; } || { echo 'Falló: se deshace el cambio' >&2; ${TAKE} && { ${revert}; }; exit 1; }`,
  ].join("\n");
}

/**
 * «Confirmar»: quita la vuelta atrás y, en firewalld, lo deja fijo. Falla (3) si ya se deshizo solo; si no
 * se pudo dejar fijo, sigue a prueba (vuelve la marca: el servidor lo deshará al acabar el tiempo).
 */
export function confirmScript(plan: FwPlan, tag: string): string {
  const fix = plan.permanent.length ? `{ ${plan.permanent.join(" && ")}; } || { touch "$M"; echo 'No se pudo dejar fijo: sigue a prueba.' >&2; exit 1; }; ` : "";
  return [
    PATH_LINE,
    vars(tag),
    `if ${TAKE}; then ${fix}rm -rf ${SAVE}; else echo 'El cambio ya se había deshecho solo (pasó el tiempo).' >&2; exit 3; fi`,
  ].join("\n");
}

/** «Deshacer ahora» (si no se había deshecho ya solo). Si falla, vuelve la marca y lo reintenta el servidor. */
export function undoScript(plan: FwPlan, tag: string): string {
  return [PATH_LINE, vars(tag), `if ${TAKE}; then { ${plan.revert.join(" && ")}; } || { touch "$M"; echo 'No se pudo deshacer: el servidor lo vuelve a intentar al acabar el tiempo.' >&2; exit 1; }; rm -rf ${SAVE}; else echo 'Ya se había deshecho solo.'; fi`].join("\n");
}
