// Comprobaciones de SSH, Usuarios y Red de la auditoría del servidor.
import type { Check, Fix } from "../../api/audit";
import type { PortsResult } from "../admin";
import { shQuote } from "../../lib/remote";
import { check, fix, lines, NEEDS_SUDO, noread, parsePasswdLines, plural, sudoUsers, type AuditCtx } from "./checksCommon";
import { sshListenPorts } from "./fixSafety";

// ───────── SSH ─────────

export interface SshdConfig {
  /** De dónde salió: sshd -T (efectiva), los archivos, o nada legible. */
  source: "sshd" | "files" | "none";
  values: Record<string, string>;
  /** sshd_config incluye sshd_config.d (se puede poner un archivo aparte). */
  include: boolean;
}

export function parseSshd(sec: Map<string, string[]>): SshdConfig {
  const values: Record<string, string> = {};
  const fromT = (sec.get("sshdsrc") ?? [])[0] === "T";
  if (fromT) {
    for (const l of sec.get("sshd") ?? []) {
      const m = /^(\S+)\s+(.*)$/.exec(l.trim());
      if (m) values[m[1].toLowerCase()] = m[2].trim().toLowerCase();
    }
  } else {
    // «archivo:  Clave valor». sshd usa el PRIMER valor que encuentra (los .d van antes en el orden del script).
    for (const l of sec.get("sshdcfg") ?? []) {
      if (l === "@noread") continue;
      const m = /^[^:]+:\s*(\S+)\s+(\S+)/.exec(l);
      if (!m) continue;
      const k = m[1].toLowerCase();
      if (!(k in values)) values[k] = m[2].toLowerCase();
    }
  }
  const cfgLines = sec.get("sshdcfg") ?? [];
  const unreadable = cfgLines.includes("@noread") || cfgLines.includes("@nofile");
  const source: SshdConfig["source"] = fromT ? "sshd" : Object.keys(values).length > 0 || (sec.has("sshdcfg") && !unreadable) ? "files" : "none";
  const include = Number((sec.get("sshinc") ?? [])[0] ?? "0") > 0;
  return { source, values, include };
}

// Sin recargar, sshd sigue con la configuración vieja. Sin systemd ni OpenRC (contenedores): SIGHUP al
// proceso principal por su pid (nunca `pkill sshd`, que también cortaría las sesiones abiertas).
const SSHD_RELOAD =
  'systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || rc-service sshd reload 2>/dev/null || kill -HUP "$(cat /run/sshd.pid 2>/dev/null || cat /var/run/sshd.pid)"';

/** Comando para fijar opciones de sshd con comprobación (`sshd -t`) y recarga. */
export function sshdFixCommand(settings: [string, string][], include: boolean): string {
  if (include) {
    // 00-: los .conf se leen en orden y sshd se queda con el PRIMER valor de cada opción.
    const f = "/etc/ssh/sshd_config.d/00-sshorus.conf";
    return [
      `f=${f}`,
      'touch "$f" && chmod 600 "$f" && cp -p "$f" "$f.bak"',
      ...settings.map(([k, v]) => `sed -i '/^${k}[[:space:]]/d' "$f" && echo '${k} ${v}' >> "$f"`),
      `sshd -t || { cp -p "$f.bak" "$f"; echo 'sshd -t falló: se dejó como estaba' >&2; exit 1; }`,
      SSHD_RELOAD,
    ].join("\n");
  }
  // Sin sshd_config.d: al principio del archivo principal (gana el primer valor), con copia.
  const c = "/etc/ssh/sshd_config";
  return [
    `cp -p ${c} ${c}.sshorus.bak`,
    ...settings.map(([k, v]) => `sed -i '1i ${k} ${v}' ${c}`),
    `sshd -t || { cp -p ${c}.sshorus.bak ${c}; echo 'sshd -t falló: se dejó como estaba' >&2; exit 1; }`,
    SSHD_RELOAD,
  ].join("\n");
}

export function sshChecks(ctx: AuditCtx): Check[] {
  const cfg = parseSshd(ctx.sec);
  const out: Check[] = [];
  if (cfg.source === "none") {
    out.push(check("ssh.root", "ssh", "Entrada de root por SSH", "skip", `${NEEDS_SUDO} (sshd -T)`, { weight: 3 }));
    out.push(check("ssh.password", "ssh", "Entrada con contraseña", "skip", `${NEEDS_SUDO} (sshd -T)`, { weight: 2 }));
  } else {
    const root = cfg.values.permitrootlogin ?? "prohibit-password";
    const rootFix = fix(sshdFixCommand([["PermitRootLogin", "no"]], cfg.include), {
      danger: true,
      note: ctx.uid === 0 ? "Te conectas como root: perderás el acceso por SSH" : "Antes, comprueba que entras con otro usuario con sudo",
    });
    if (root === "yes") {
      out.push(check("ssh.root", "ssh", "Entrada de root por SSH", "bad", "root puede entrar por SSH, también con contraseña", { weight: 3, fix: rootFix }));
    } else if (root === "prohibit-password" || root === "without-password") {
      out.push(check("ssh.root", "ssh", "Entrada de root por SSH", "warn", "root puede entrar por SSH con clave", { weight: 1, fix: rootFix }));
    } else {
      out.push(check("ssh.root", "ssh", "Entrada de root por SSH", "ok", "root no puede entrar por SSH", { weight: 3 }));
    }
    const pw = (cfg.values.passwordauthentication ?? "yes") === "yes";
    const empty = cfg.values.permitemptypasswords === "yes";
    ctx.passwordAuth = pw;
    const pwFix = fix(
      sshdFixCommand(
        [
          ["PasswordAuthentication", "no"],
          ["KbdInteractiveAuthentication", "no"],
          ...(empty ? ([["PermitEmptyPasswords", "no"]] as [string, string][]) : []),
        ],
        cfg.include,
      ),
      { danger: true, note: "Antes, comprueba que entras con clave: si no, perderás el acceso" },
    );
    if (empty) out.push(check("ssh.password", "ssh", "Entrada con contraseña", "bad", "Se permite entrar con contraseña vacía", { weight: 3, fix: pwFix }));
    else if (pw) out.push(check("ssh.password", "ssh", "Entrada con contraseña", "warn", "Se puede entrar con contraseña (mejor solo con clave)", { weight: 2, fix: pwFix }));
    else out.push(check("ssh.password", "ssh", "Entrada con contraseña", "ok", "Solo se entra con clave", { weight: 2 }));
    const port = Number(cfg.values.port);
    if (Number.isInteger(port) && port > 0) ctx.sshPort = port;
  }

  // Claves autorizadas: «usuario|n|modo|ruta» (n = «?» si no se pudo leer).
  const keys = lines(ctx, "keys").map((l) => l.split("|"));
  const seen = keys.filter((k) => k[1] !== "?" && Number(k[1]) > 0);
  const hidden = keys.filter((k) => k[1] === "?");
  const loose = keys.filter((k) => /^[0-7]{3,4}$/.test(k[2] ?? "") && (Number.parseInt(k[2], 8) & 0o022) !== 0);
  const total = seen.reduce((a, k) => a + Number(k[1]), 0);
  const items = seen.map((k) => `${k[0]}: ${plural(Number(k[1]), "clave", "claves")} (${k[3]})`);
  if (hidden.length && !ctx.elevated) items.push(`${plural(hidden.length, "usuario", "usuarios")} más sin poder leer (necesita sudo)`);
  if (loose.length) {
    out.push(
      check("ssh.keys", "ssh", "Claves autorizadas", "bad", "Hay archivos authorized_keys que otros pueden modificar", {
        weight: 2,
        items: [...loose.map((k) => `${k[3]} (permisos ${k[2]})`), ...items],
        fix: fix(`chmod 600 ${loose.map((k) => shQuote(k[3])).join(" ")}`),
      }),
    );
  } else {
    out.push(
      check(
        "ssh.keys",
        "ssh",
        "Claves autorizadas",
        "info",
        seen.length
          ? `${plural(seen.length, "usuario tiene", "usuarios tienen")} ${plural(total, "clave", "claves")} autorizada${total === 1 ? "" : "s"}: revisa que las reconoces`
          : hidden.length
            ? NEEDS_SUDO
            : "Ningún usuario tiene claves autorizadas",
        { items },
      ),
    );
  }
  return out;
}

// ───────── Usuarios ─────────

export function userChecks(ctx: AuditCtx): Check[] {
  const out: Check[] = [];
  const passwd = parsePasswdLines(lines(ctx, "passwd"));
  const sudoers = lines(ctx, "sudoers");
  const sudo = sudoUsers(lines(ctx, "groups"), sudoers);
  out.push(
    check("users.sudo", "users", "Usuarios con sudo", "info", sudo.length ? `${plural(sudo.length, "usuario puede", "usuarios pueden")} usar sudo` : "Nadie aparte de root usa sudo", {
      items: sudo,
    }),
  );

  if (noread(ctx, "sudoers")) {
    out.push(check("users.nopasswd", "users", "sudo sin contraseña", "skip", NEEDS_SUDO, { weight: 2 }));
  } else {
    const np = sudoers.filter((l) => /NOPASSWD\s*:/.test(l) || /^doas:\s*permit\s+nopass\b/.test(l));
    out.push(
      np.length
        ? check("users.nopasswd", "users", "sudo sin contraseña", "warn", `${plural(np.length, "regla da", "reglas dan")} root sin pedir contraseña (NOPASSWD)`, {
            weight: 2,
            items: np,
            fix: fix("visudo -f /etc/sudoers.d/<archivo>", { manual: true, note: "Quita «NOPASSWD:» de esas reglas" }),
          })
        : check("users.nopasswd", "users", "sudo sin contraseña", "ok", "sudo siempre pide contraseña", { weight: 2 }),
    );
  }

  if (noread(ctx, "shadow") || !ctx.sec.has("shadow")) {
    out.push(check("users.empty", "users", "Cuentas sin contraseña", "skip", NEEDS_SUDO, { weight: 3 }));
  } else {
    const empty = lines(ctx, "shadow")
      .map((l) => l.split(":"))
      .filter((p) => p[1] === "empty")
      .map((p) => p[0]);
    out.push(
      empty.length
        ? check("users.empty", "users", "Cuentas sin contraseña", "bad", `${plural(empty.length, "cuenta no tiene", "cuentas no tienen")} contraseña`, {
            weight: 3,
            items: empty,
            fix: fix(empty.map((u) => `passwd -l ${shQuote(u)}`).join("\n"), { manual: true, note: "Bloquea su contraseña (sus llaves SSH siguen sirviendo)" }),
          })
        : check("users.empty", "users", "Cuentas sin contraseña", "ok", "Todas las cuentas tienen contraseña o están bloqueadas", { weight: 3 }),
    );
  }

  const uid0 = passwd.filter((u) => u.uid === 0 && u.name !== "root").map((u) => u.name);
  out.push(
    uid0.length
      ? check("users.uid0", "users", "Otras cuentas con UID 0", "bad", `${plural(uid0.length, "cuenta más es", "cuentas más son")} root (UID 0)`, {
          weight: 3,
          items: uid0,
          fix: fix(uid0.map((u) => `userdel ${shQuote(u)}`).join("\n"), { manual: true, note: "Si no la reconoces, bórrala o cámbiale el UID" }),
        })
      : check("users.uid0", "users", "Otras cuentas con UID 0", "ok", "Solo root tiene UID 0", { weight: 3 }),
  );
  return out;
}

// ───────── Red ─────────

function expectedPort(proto: string, port: number, sshPort: number): boolean {
  if (proto === "tcp") return port === sshPort || port === 22 || port === 80 || port === 443;
  return port === 443 || port === 68 || port === 546;
}

export interface FirewallState {
  active: string[];
  inactive: string[];
  unknown: string[];
  installed: string[];
}

export function parseFirewall(ls: string[]): FirewallState {
  const st: FirewallState = { active: [], inactive: [], unknown: [], installed: [] };
  for (const l of ls) {
    const p = l.trim().split(/\s+/);
    const tool = p[0];
    if (!tool) continue;
    st.installed.push(tool);
    if (p[1] === "?") st.unknown.push(tool);
    else if (tool === "firewalld") (p[1] === "running" ? st.active : st.inactive).push(tool);
    else if (tool === "ufw") (p[1] === "active" ? st.active : st.inactive).push(tool);
    else if (tool === "nft" || tool === "iptables") (Number(p[2]) > 0 || Number(p[3]) > 0 ? st.active : st.inactive).push(tool);
  }
  return st;
}

export function netChecks(ctx: AuditCtx, ports: PortsResult | null): Check[] {
  const out: Check[] = [];
  const fw = parseFirewall(lines(ctx, "fw"));
  const exposed = (ports?.ports ?? []).filter((p) => p.scope !== "local");
  const extra = exposed.filter((p) => !expectedPort(p.proto, p.port, ctx.sshPort));
  const fwOn = fw.active.length > 0;

  if (!ports) {
    out.push(check("net.ports", "net", "Puertos abiertos al exterior", "skip", "No se pudieron leer los puertos", { weight: 2 }));
  } else {
    const items = extra.map((p) => {
      const who = p.container ? `contenedor ${p.container}` : p.unit ?? p.procs[0]?.name ?? "proceso desconocido";
      return `${p.proto} ${p.ip.includes(":") ? `[${p.ip}]` : p.ip}:${p.port} · ${who}`;
    });
    out.push(
      extra.length
        ? check(
            "net.ports",
            "net",
            "Puertos abiertos al exterior",
            "warn",
            `${plural(extra.length, "puerto escucha", "puertos escuchan")} fuera de esta máquina además de SSH y web${fwOn ? " (el cortafuegos puede bloquearlos)" : ""}`,
            { weight: fwOn ? 1 : 2, items, fix: fix("# Haz que escuche en 127.0.0.1 o ciérralo en el cortafuegos", { manual: true }) },
          )
        : check("net.ports", "net", "Puertos abiertos al exterior", "ok", "Solo SSH y web escuchan fuera de esta máquina", { weight: 2 }),
    );
  }

  if (fwOn) {
    out.push(check("net.firewall", "net", "Cortafuegos", "ok", `Activo (${fw.active.join(", ")})`, { weight: 2 }));
  } else if (fw.unknown.length && !ctx.elevated) {
    out.push(check("net.firewall", "net", "Cortafuegos", "skip", `${NEEDS_SUDO} (${fw.unknown.join(", ")})`, { weight: 2 }));
  } else {
    const web = exposed.filter((p) => p.proto === "tcp" && (p.port === 80 || p.port === 443)).map((p) => p.port);
    const allow = [...new Set(web)];
    let f: Fix;
    const strong = { danger: true, note: "Solo deja pasar SSH y la web: abre antes lo que necesites" };
    const ssh = sshListenPorts(ports, ctx.sshPort);
    if (fw.installed.includes("firewalld")) {
      const svc = [...ssh.map((p) => (p === 22 ? "--add-service=ssh" : `--add-port=${p}/tcp`)), ...allow.map((p) => (p === 80 ? "--add-service=http" : "--add-service=https"))];
      f = fix(["systemctl enable --now firewalld", `firewall-cmd --permanent ${svc.join(" ")}`, "firewall-cmd --reload"].join("\n"), strong);
    } else if (fw.installed.includes("ufw")) {
      f = fix([...ssh.map((p) => `ufw allow ${p}/tcp`), ...allow.map((p) => `ufw allow ${p}/tcp`), "ufw --force enable"].join("\n"), strong);
    } else {
      const install =
        ctx.family === "debian" ? "apt-get install -y ufw" : ctx.family === "alpine" ? "apk add nftables" : ctx.family === "other" ? "# instala un cortafuegos" : "dnf -y install firewalld";
      f = fix(install, { manual: true, note: "Instálalo y vuelve a auditar para activarlo" });
    }
    out.push(check("net.firewall", "net", "Cortafuegos", "bad", "No hay ningún cortafuegos activo", { weight: 2, fix: f }));
  }
  return out;
}
