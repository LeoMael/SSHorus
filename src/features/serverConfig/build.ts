// Arma las secciones del panel a partir de la salida de CONFIG_SCRIPT. Lo que ya comprueba la Auditoría
// (SSH, sudo, fail2ban, hidepid, cortafuegos) sale de SUS comprobaciones y arreglos; aquí solo se añade
// el detalle y lo propio del panel. Funciones puras.
import type { Check } from "../../api/audit";
import { buildContext, parseFirewall, parseSshd, type AuditCtx } from "../audit/checks";
import { hardeningChecks } from "../audit/checksHardening";
import { sshChecks, userChecks } from "../audit/checksSshNet";
import { loginChecks } from "../audit/checksSystem";
import { autoUpdSection, parseAutoUpd } from "./autoUpdates";
import { jailRows, parseFail2ban } from "./fail2ban";
import { macSection } from "./mac";
import { section, worst, type ConfigSection, type Fact, type ServerConfig } from "./model";
import { parseSysctl, parseSysFiles, sysctlChange, sysctlPending, sysctlRows } from "./sysctl";

const NEEDS_SUDO = "Sin sudo no se puede leer";

/** Estado de una sección a partir de sus comprobaciones («info» no empeora nada). */
function fromChecks(cs: Check[]): ConfigSection["status"] {
  return cs.length ? worst(...cs.map((c) => (c.status === "info" ? "ok" : c.status))) : "skip";
}

function sshSection(ctx: AuditCtx, checks: Check[]): ConfigSection {
  const cfg = parseSshd(ctx.sec);
  const v = (k: string) => cfg.values[k] ?? (cfg.source === "none" ? "?" : "por defecto");
  const facts: Fact[] =
    cfg.source === "none"
      ? []
      : [
          { label: "Puerto", value: cfg.values.port ?? "22" },
          { label: "Entrar como root (PermitRootLogin)", value: v("permitrootlogin") },
          { label: "Con contraseña (PasswordAuthentication)", value: v("passwordauthentication") },
          { label: "Con teclado (KbdInteractiveAuthentication)", value: v("kbdinteractiveauthentication") },
          { label: "Con clave (PubkeyAuthentication)", value: v("pubkeyauthentication") },
          { label: "Leído de", value: cfg.source === "sshd" ? "la configuración efectiva (sshd -T)" : "los archivos de /etc/ssh" },
        ];
  const notes = [
    cfg.source === "none" ? `${NEEDS_SUDO} la configuración de SSH (sshd -T).` : null,
    cfg.source === "files" ? "Leído de los archivos sin sudo: puede no ser exactamente lo que usa sshd." : null,
    "Los cambios se comprueban con «sshd -t» antes de recargar, y recargar no corta las sesiones abiertas. El puerto no se cambia desde aquí (hay que abrirlo antes en el cortafuegos y, con SELinux, en ssh_port_t).",
  ].filter((n): n is string => !!n);
  const main = checks.filter((c) => c.id !== "ssh.keys");
  return section({
    id: "ssh",
    title: "SSH",
    status: fromChecks(main),
    summary: main.map((c) => c.detail).join(" · "),
    facts,
    checks,
    notes,
  });
}

function firewallSection(ctx: AuditCtx): ConfigSection {
  const fw = parseFirewall(ctx.sec.get("fw") ?? []);
  const facts: Fact[] = fw.installed.map((t) => ({
    label: t,
    value: fw.active.includes(t) ? "activo" : fw.unknown.includes(t) ? "sin sudo no se ve" : "apagado o sin reglas",
    status: fw.active.includes(t) ? "ok" : fw.unknown.includes(t) ? "skip" : "warn",
  }));
  const on = fw.active.length > 0;
  const unknown = !on && fw.unknown.length > 0 && !ctx.elevated;
  return section({
    id: "firewall",
    title: "Cortafuegos",
    status: on ? "ok" : unknown ? "skip" : "bad",
    summary: on ? `Activo (${fw.active.join(", ")})` : unknown ? `${NEEDS_SUDO} el estado (${fw.unknown.join(", ")})` : fw.installed.length ? "Ningún cortafuegos está activo" : "No hay ningún cortafuegos instalado",
    facts,
    notes: ["Las reglas, abrir y cerrar puertos y activarlo están en el mapa (nodo «Cortafuegos»), con cambios a prueba que se deshacen solos si te quedas fuera."],
    link: "firewall",
  });
}

function fail2banSection(ctx: AuditCtx, ls: string[], myIp: string | null): ConfigSection {
  const st = parseFail2ban(ls);
  const checks = loginChecks(ctx);
  const active = (ctx.sec.get("auth") ?? []).includes("f2b active");
  const banned = st.jails.reduce((a, j) => a + (j.bannedNow ?? 0), 0);
  const notes: string[] = [];
  if (st.noread) notes.push(`${NEEDS_SUDO} el estado de las cárceles (fail2ban-client).`);
  if (active && ctx.sshPort !== 22) notes.push(`SSH escucha en el ${ctx.sshPort}: la cárcel «sshd» debe tener «port = ${ctx.sshPort}» o bloqueará solo el 22.`);
  const summary = !st.installed
    ? "No está instalado: nadie bloquea a quien prueba contraseñas"
    : st.running
      ? `Activo: ${st.jails.length} ${st.jails.length === 1 ? "cárcel" : "cárceles"}, ${banned} ${banned === 1 ? "dirección bloqueada" : "direcciones bloqueadas"} ahora`
      : active
        ? "Activo"
        : "Instalado pero parado";
  return section({
    id: "fail2ban",
    title: "fail2ban",
    status: st.running || active ? "ok" : fromChecks(checks.filter((c) => c.id === "logins.fail2ban")),
    summary,
    checks,
    notes,
    groups: st.installed && !st.noread ? [{ title: "Cárceles y direcciones bloqueadas", empty: st.running ? "No hay cárceles activas" : "fail2ban no responde", rows: jailRows(st, myIp) }] : [],
  });
}

function sudoSection(ctx: AuditCtx): ConfigSection {
  const checks = userChecks(ctx).filter((c) => c.id === "users.sudo" || c.id === "users.nopasswd");
  const admin = (ctx.sec.get("groups") ?? []).map((g) => g.split(":")).map((p) => ({ label: `Grupo «${p[0]}»`, value: (p[3] ?? "").split(",").filter(Boolean).join(", ") || "nadie" }));
  return section({
    id: "sudo",
    title: "Usuarios con sudo",
    status: fromChecks(checks),
    summary: checks.map((c) => c.detail).join(" · "),
    facts: admin,
    checks,
    link: "users",
  });
}

function sysctlSection(ls: (k: string) => string[]): ConfigSection {
  const vals = parseSysctl(ls("sysctl"));
  if (!vals.size) return section({ id: "sysctl", title: "Red del kernel (sysctl)", status: "skip", summary: "No se pudo leer /proc/sys" });
  const pending = sysctlPending(vals);
  const ch = sysctlChange(pending, vals);
  return section({
    id: "sysctl",
    title: "Red del kernel (sysctl)",
    status: pending.length ? "warn" : "ok",
    summary: pending.length ? `${pending.length} ${pending.length === 1 ? "valor se puede" : "valores se pueden"} endurecer` : "Con los valores recomendados",
    groups: [{ title: "Valores", empty: "", rows: sysctlRows(vals, parseSysFiles(ls("sysfile"))) }],
    changes: ch ? [ch] : [],
  });
}

function hidepidSection(ctx: AuditCtx, fstab: string[]): ConfigSection {
  const checks = hardeningChecks(ctx).filter((c) => c.id === "hard.hidepid");
  const mount = (ctx.sec.get("proc") ?? [])[0]?.split(/\s+/)[3] ?? null;
  return section({
    id: "hidepid",
    title: "Procesos de otros usuarios (hidepid)",
    status: fromChecks(checks),
    summary: checks[0]?.detail ?? "No se pudo leer",
    facts: [
      { label: "/proc montado con", value: mount ?? "?" },
      { label: "/etc/fstab", value: fstab[0]?.trim() ?? "sin línea para /proc (se monta con lo de por defecto)" },
    ],
    checks,
    notes: ["Con hidepid, el Monitor de SSHorus sin sudo solo ve tus procesos. Algunos servicios de systemd (polkit) pueden necesitar «gid=»: si algo falla, quita hidepid de /etc/fstab."],
  });
}

/** Todas las secciones. `myIp`: dirección desde la que se conecta SSHorus (para fail2ban). */
export function buildConfig(stdout: string, elevated: boolean, myIp: string | null): ServerConfig {
  const ctx = buildContext(stdout, elevated);
  const ls = (k: string) => ctx.sec.get(k) ?? [];
  // sshChecks va primero: fija el puerto de SSH y si se entra con contraseña (lo usa fail2ban).
  const ssh = sshSection(ctx, sshChecks(ctx));
  const sections = [
    macSection(ls, ctx.elevated),
    ssh,
    firewallSection(ctx),
    autoUpdSection(parseAutoUpd(ls("autoupd"))),
    fail2banSection(ctx, ls("fban"), myIp),
    sudoSection(ctx),
    sysctlSection(ls),
    hidepidSection(ctx, ls("fstab")),
  ];
  return { sections, elevated: ctx.elevated, os: ctx.os.name || ctx.os.id };
}
