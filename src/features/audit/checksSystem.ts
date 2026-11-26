// Comprobaciones de Actualizaciones, Sitios web, Contenedores, Sistema e Intentos de entrada.
import type { Check, CheckStatus } from "../../api/audit";
import { shQuote } from "../../lib/remote";
import { certStatus, type WebResult } from "../admin/webTypes";
import { rebootPending, type RebootPending } from "../reboot/detect";
import { check, fix, lines, NEEDS_SUDO, plural, type AuditCtx, type AuditInput, type Family } from "./checksCommon";

const REBOOT_CHECK: Record<RebootPending, [CheckStatus, string]> = {
  required: ["warn", "Hay que reiniciar para usar el núcleo o las bibliotecas nuevas"],
  "kernel-gone": ["warn", "El núcleo en marcha ya no está instalado: reinicia"],
  no: ["ok", "No hace falta reiniciar"],
  unknown: ["skip", "No se pudo saber"],
};

// ───────── Actualizaciones ─────────

function upgradeCommand(mgr: string, securityOnly: boolean): string | null {
  switch (mgr) {
    case "dnf":
    case "yum":
      return `${mgr} -y upgrade${securityOnly ? " --security" : ""}`;
    case "apt":
      return "apt-get update\nDEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold --with-new-pkgs upgrade";
    case "apk":
      return "apk update\napk upgrade";
    default:
      return null;
  }
}

export function updateChecks(ctx: AuditCtx, vuln: AuditInput["vuln"], now: number): Check[] {
  const out: Check[] = [];
  const [mgr = "none", t = "?", s = "?"] = (lines(ctx, "updates")[0] ?? "none|?|?").split("|");
  const total = /^\d+$/.test(t) ? Number(t) : null;
  const sec = /^\d+$/.test(s) ? Number(s) : null;
  if (total === null) {
    out.push(check("updates.pending", "updates", "Actualizaciones pendientes", "skip", mgr === "none" ? "Gestor de paquetes no reconocido" : "No se pudo leer (sin caché de paquetes)", { weight: 3 }));
  } else if (sec !== null && sec > 0) {
    const c = upgradeCommand(mgr, mgr === "dnf" || mgr === "yum");
    out.push(
      check("updates.pending", "updates", "Actualizaciones pendientes", "bad", `${plural(sec, "actualización", "actualizaciones")} de seguridad (${total} en total)`, {
        weight: 3,
        fix: c ? fix(c, { note: "Puede reiniciar servicios" }) : null,
      }),
    );
  } else if (total > 0) {
    const c = upgradeCommand(mgr, false);
    out.push(
      check("updates.pending", "updates", "Actualizaciones pendientes", "warn", `${plural(total, "paquete por", "paquetes por")} actualizar`, {
        weight: 2,
        fix: c ? fix(c, { note: "Puede reiniciar servicios" }) : null,
      }),
    );
  } else {
    out.push(check("updates.pending", "updates", "Actualizaciones pendientes", "ok", mgr === "apt" ? "Al día (según el último «apt update»)" : "Al día", { weight: 3 }));
  }

  const [rbStatus, rbDetail] = REBOOT_CHECK[rebootPending(lines(ctx, "reboot")).state];
  const rebootFix = fix("command -v systemctl >/dev/null && systemctl reboot || reboot", { danger: true, note: "El servidor se reinicia ahora: se cortan las conexiones" });
  out.push(check("updates.reboot", "updates", "Reinicio pendiente", rbStatus, rbDetail, { weight: 2, fix: rbStatus === "warn" ? rebootFix : null }));

  if (!vuln) {
    out.push(check("updates.vulns", "updates", "Vulnerabilidades conocidas", "skip", "Sin analizar: usa «Analizar» en Vulnerabilidades", { weight: 3 }));
  } else {
    const days = Math.floor((now - Date.parse(vuln.createdAt)) / 86_400_000);
    const when = Number.isFinite(days) ? (days <= 0 ? "informe de hoy" : `informe de hace ${plural(days, "día", "días")}`) : "último informe";
    const v = vuln.summary;
    const text = `${plural(v.critical, "crítica", "críticas")}, ${plural(v.high, "alta", "altas")} (${when})`;
    out.push(
      check("updates.vulns", "updates", "Vulnerabilidades conocidas", v.critical > 0 ? "bad" : v.high > 0 ? "warn" : "ok", v.critical + v.high > 0 ? text : `Sin críticas ni altas (${when})`, {
        weight: 3,
      }),
    );
  }
  return out;
}

// ───────── Sitios web ─────────

export function webChecks(web: WebResult | null, now: number): Check[] {
  if (!web) return [check("web.certs", "web", "Certificados de los sitios", "skip", "No se pudieron leer los sitios web", { weight: 2 })];
  const items: string[] = [];
  let worst: CheckStatus = "ok";
  let count = 0;
  let nginx = false;
  for (const srv of web.servers) {
    for (const site of srv.sites) {
      if (!site.https || site.certExpires === null) continue;
      count++;
      const st = certStatus(site.certExpires, now);
      if (!st || st.level === "ok") continue;
      if (srv.server === "nginx") nginx = true;
      items.push(`${site.names[0] ?? "(por defecto)"} · ${st.text}`);
      if (st.level === "bad") worst = "bad";
      else if (worst === "ok") worst = "warn";
    }
  }
  if (count === 0) return [check("web.certs", "web", "Certificados de los sitios", "info", "No hay sitios con certificado propio para revisar")];
  if (worst === "ok") return [check("web.certs", "web", "Certificados de los sitios", "ok", `${plural(count, "certificado vale", "certificados valen")} más de 30 días`, { weight: 2 })];
  return [
    check("web.certs", "web", "Certificados de los sitios", worst, `${plural(items.length, "certificado caduca", "certificados caducan")} en menos de 30 días`, {
      weight: worst === "bad" ? 3 : 2,
      items,
      fix: nginx ? fix("certbot renew && systemctl reload nginx", { manual: true, note: "Si usas certbot; si no, renuévalo con tu herramienta" }) : null,
    }),
  ];
}

// ───────── Contenedores ─────────

export interface ContainerRow {
  engine: string;
  rootful: boolean;
  name: string;
  privileged: boolean;
  user: string;
  ports: string[];
}

export function parseContainersAudit(ls: string[], uid: number | null): ContainerRow[] {
  const out: ContainerRow[] = [];
  let engine = "";
  let rootful = false;
  for (const l of ls) {
    const e = /^@engine (\S+) (\S*)$/.exec(l);
    if (e) {
      engine = e[1];
      const rootless = e[2] === "true";
      rootful = engine === "docker" ? !rootless : uid === 0 && !rootless;
      continue;
    }
    const p = l.split("|");
    if (!engine || p.length < 4) continue;
    out.push({
      engine,
      rootful,
      name: p[0].replace(/^\//, ""),
      privileged: p[1] === "true",
      user: p[2].trim(),
      ports: p.slice(3).join("|").trim().split(/\s+/).filter(Boolean),
    });
  }
  return out;
}

export function containerChecks(ctx: AuditCtx): Check[] {
  const rows = parseContainersAudit(lines(ctx, "ctr"), ctx.uid);
  if (rows.length === 0) return [check("ctr.none", "containers", "Contenedores", "info", "No hay contenedores en marcha (de este usuario)")];
  const out: Check[] = [];
  const priv = rows.filter((r) => r.privileged);
  out.push(
    priv.length
      ? check("ctr.privileged", "containers", "Contenedores con --privileged", "bad", `${plural(priv.length, "contenedor tiene", "contenedores tienen")} acceso total al servidor`, {
          weight: 3,
          items: priv.map((r) => `${r.name} (${r.engine})`),
          fix: fix("# Vuelve a crear el contenedor sin --privileged (o solo con --cap-add necesarios)", { manual: true }),
        })
      : check("ctr.privileged", "containers", "Contenedores con --privileged", "ok", "Ninguno tiene --privileged", { weight: 3 }),
  );
  const asRoot = rows.filter((r) => r.rootful && (r.user === "" || r.user === "root" || r.user === "0" || /^(0|root):/.test(r.user)));
  out.push(
    asRoot.length
      ? check("ctr.root", "containers", "Contenedores como root", "warn", `${plural(asRoot.length, "contenedor corre", "contenedores corren")} como root en un motor con root`, {
          weight: 1,
          items: asRoot.map((r) => `${r.name} (${r.engine})`),
          fix: fix("# Usa --user con un usuario sin privilegios o Podman sin root", { manual: true }),
        })
      : check("ctr.root", "containers", "Contenedores como root", "ok", "Ninguno corre como root con un motor con root", { weight: 1 }),
  );
  const open: string[] = [];
  for (const r of rows) {
    for (const b of r.ports) {
      const m = /^(.*):(\d+)->/.exec(b);
      if (!m) continue;
      const ip = m[1];
      const port = Number(m[2]);
      if ((ip === "" || ip === "0.0.0.0" || ip === "::") && port !== 80 && port !== 443) open.push(`${r.name}: ${b}`);
    }
  }
  out.push(
    open.length
      ? check("ctr.ports", "containers", "Puertos de contenedores expuestos", "warn", `${plural(open.length, "puerto publicado", "puertos publicados")} en todas las interfaces`, {
          weight: 1,
          items: open,
          fix: fix("# Publica con -p 127.0.0.1:PUERTO:PUERTO y pon delante el proxy web", { manual: true }),
        })
      : check("ctr.ports", "containers", "Puertos de contenedores expuestos", "ok", "Solo publican la web o en 127.0.0.1", { weight: 1 }),
  );
  return out;
}

// ───────── Sistema e Intentos de entrada ─────────

const SKIP_FS = /^(tmpfs|devtmpfs|overlay|squashfs|shm|none|udev|efivarfs|cgroup.*|\/dev\/loop.*)$/;
const SKIP_MOUNT = /^\/(dev|proc|sys|run|snap)(\/|$)/;

export function parseDf(ls: string[]): { mount: string; pct: number }[] {
  const out: { mount: string; pct: number }[] = [];
  for (const l of ls) {
    const p = l.trim().split(/\s+/);
    if (p.length < 6) continue;
    const pct = Number(p[4].replace("%", ""));
    const mount = p.slice(5).join(" ");
    if (!Number.isFinite(pct) || (SKIP_FS.test(p[0]) && !(p[0] === "overlay" && mount === "/")) || SKIP_MOUNT.test(mount)) continue;
    out.push({ mount, pct });
  }
  return out;
}

export function parseMem(ls: string[]): { total: number; avail: number; swapTotal: number; swapFree: number } | null {
  const v: Record<string, number> = {};
  for (const l of ls) {
    const m = /^(\w+):\s+(\d+)/.exec(l);
    if (m) v[m[1]] = Number(m[2]);
  }
  if (!v.MemTotal) return null;
  return { total: v.MemTotal, avail: v.MemAvailable ?? v.MemFree ?? 0, swapTotal: v.SwapTotal ?? 0, swapFree: v.SwapFree ?? 0 };
}

export function systemChecks(ctx: AuditCtx): Check[] {
  const out: Check[] = [];
  const failed = lines(ctx, "failed");
  if (failed.includes("@nosvc")) out.push(check("system.failed", "system", "Servicios caídos", "skip", "Sin systemd ni OpenRC"));
  else
    out.push(
      failed.length
        ? check("system.failed", "system", "Servicios caídos", "warn", `${plural(failed.length, "servicio falló", "servicios fallaron")}`, {
            weight: 1,
            items: failed,
            fix: fix(`systemctl status ${failed.map(shQuote).join(" ")} --no-pager`, { manual: true, note: "Mira por qué falló" }),
          })
        : check("system.failed", "system", "Servicios caídos", "ok", "Ningún servicio caído"),
    );

  const disks = parseDf(lines(ctx, "disk"));
  const full = disks.filter((d) => d.pct >= 80).sort((a, b) => b.pct - a.pct);
  if (!disks.length) out.push(check("system.disk", "system", "Disco", "skip", "No se pudo leer el disco"));
  else if (full.length) {
    const bad = full[0].pct >= 90;
    out.push(
      check("system.disk", "system", "Disco", bad ? "bad" : "warn", `${plural(full.length, "disco está", "discos están")} al ${full[0].pct} % o más`, {
        weight: 2,
        items: full.map((d) => `${d.mount} · ${d.pct} %`),
        fix: fix(`du -xh -d1 ${shQuote(full[0].mount)} 2>/dev/null | sort -h | tail -n 15`, { manual: true, note: "Qué ocupa más" }),
      }),
    );
  } else out.push(check("system.disk", "system", "Disco", "ok", `Todos por debajo del 80 % (máx. ${Math.max(...disks.map((d) => d.pct))} %)`, { weight: 2 }));

  const mem = parseMem(lines(ctx, "mem"));
  if (!mem) out.push(check("system.mem", "system", "Memoria", "skip", "No se pudo leer la memoria"));
  else {
    const free = Math.round((mem.avail / mem.total) * 100);
    const swapUsed = mem.swapTotal > 0 ? Math.round(((mem.swapTotal - mem.swapFree) / mem.swapTotal) * 100) : 0;
    const gb = (mem.total / 1048576).toFixed(1).replace(".", ",");
    const st: CheckStatus = free < 10 ? "bad" : free < 20 || swapUsed > 80 ? "warn" : "ok";
    out.push(check("system.mem", "system", "Memoria", st, `${free} % libre de ${gb} GB${swapUsed > 0 ? ` · swap al ${swapUsed} %` : ""}`, { weight: st === "bad" ? 2 : 1 }));
  }
  return out;
}

function fail2banInstall(family: Family): string | null {
  const jail = "printf '[sshd]\\nenabled = true\\nbackend = systemd\\n' > /etc/fail2ban/jail.d/sshorus.local";
  switch (family) {
    case "fedora":
      return ["dnf -y install fail2ban", jail, "systemctl enable --now fail2ban"].join("\n");
    case "rhel":
      return ["dnf -y install epel-release", "dnf -y install fail2ban", jail, "systemctl enable --now fail2ban"].join("\n");
    case "debian":
      return ["apt-get install -y fail2ban python3-systemd", jail, "systemctl enable --now fail2ban"].join("\n");
    case "alpine":
      return ["apk add fail2ban", "rc-update add fail2ban", "rc-service fail2ban start"].join("\n");
    default:
      return null;
  }
}

export function loginChecks(ctx: AuditCtx): Check[] {
  const out: Check[] = [];
  const a = lines(ctx, "auth");
  const j = a.find((l) => l.startsWith("journal "));
  const f = a.find((l) => l.startsWith("file "));
  const f2b = a.find((l) => l.startsWith("f2b "))?.slice(4) ?? "none";
  const n = j ? Number(j.split(" ")[1]) : f ? Number(f.split(" ")[1]) : null;
  if (n === null || !Number.isFinite(n)) out.push(check("logins.failed", "logins", "Intentos de entrada fallidos", "skip", NEEDS_SUDO));
  else {
    const many = n > 200 && f2b !== "active";
    out.push(check("logins.failed", "logins", "Intentos de entrada fallidos", many ? "warn" : "info", `${n} intentos fallidos${j ? " en 24 h" : " en el registro"}`, { weight: 1 }));
  }
  if (f2b === "active") out.push(check("logins.fail2ban", "logins", "fail2ban", "ok", "Activo: bloquea a quien falla muchas veces", { weight: 2 }));
  else {
    const cmd = f2b === "inactive" ? (ctx.family === "alpine" ? "rc-update add fail2ban\nrc-service fail2ban start" : "systemctl enable --now fail2ban") : fail2banInstall(ctx.family);
    const need = ctx.passwordAuth !== false;
    out.push(
      check("logins.fail2ban", "logins", "fail2ban", need ? "warn" : "info", `${f2b === "inactive" ? "Instalado pero parado" : "No está instalado"}${need ? "" : " (solo se entra con clave)"}`, {
        weight: 2,
        fix: cmd ? fix(cmd) : null,
      }),
    );
  }
  return out;
}
