// Comprobaciones de Endurecimiento de la auditoría del servidor.
import type { Check } from "../../api/audit";
import { shQuote } from "../admin/shell";
import { check, fix, lines, NEEDS_SUDO, plural, type AuditCtx } from "./checksCommon";

export function hardeningChecks(ctx: AuditCtx): Check[] {
  const out: Check[] = [];
  const proc = lines(ctx, "proc")[0] ?? "";
  if (!proc) out.push(check("hard.hidepid", "hardening", "Procesos ocultos a otros usuarios", "skip", "No se pudo leer /proc/mounts"));
  else if (/hidepid=(1|2|noaccess|invisible)/.test(proc)) out.push(check("hard.hidepid", "hardening", "Procesos ocultos a otros usuarios", "ok", "/proc tiene hidepid"));
  else
    out.push(
      check("hard.hidepid", "hardening", "Procesos ocultos a otros usuarios", "warn", "Cualquier usuario ve los procesos de todos (/proc sin hidepid)", {
        weight: 1,
        fix: fix(
          [
            "mount -o remount,hidepid=2 /proc",
            "grep -qE '^proc[[:space:]]+/proc' /etc/fstab || echo 'proc /proc proc defaults,hidepid=2 0 0' >> /etc/fstab",
            "sed -i -E '/^proc[[:space:]]+\\/proc[[:space:]]/{/hidepid=/!s/^(proc[[:space:]]+\\/proc[[:space:]]+proc[[:space:]]+)([^[:space:]]+)/\\1\\2,hidepid=2/}' /etc/fstab",
          ].join("\n"),
          { danger: true, note: "Algunas herramientas de monitorización dejan de ver procesos ajenos" },
        ),
      }),
    );

  // Permisos de archivos clave: «ruta modo dueño grupo».
  const bad: string[] = [];
  const cmds: string[] = [];
  for (const l of lines(ctx, "perms")) {
    const [path, modeS, , group] = l.split(" ");
    const mode = Number.parseInt(modeS ?? "", 8);
    if (!Number.isFinite(mode)) continue;
    // shadow: nadie más que root y el grupo «shadow» (Debian/Alpine) puede leerlo.
    const groupReads = (mode & 0o040) !== 0 && !["root", "shadow", "auth"].includes(group ?? "");
    if ((path === "/etc/shadow" || path === "/etc/gshadow") && ((mode & 0o027) !== 0 || groupReads)) {
      bad.push(`${path} (${modeS})`);
      cmds.push(groupReads ? `chgrp root ${path} && chmod o-rwx,g-rwx ${path}` : `chmod o-rwx,g-wx ${path}`);
    } else if (path === "/etc/sudoers" && (mode & 0o022) !== 0) {
      bad.push(`${path} (${modeS})`);
      cmds.push(`chmod 440 ${path}`);
    } else if ((path === "/etc/passwd" || path === "/etc/ssh/sshd_config") && (mode & 0o022) !== 0) {
      bad.push(`${path} (${modeS})`);
      cmds.push(`chmod go-w ${path}`);
    }
  }
  out.push(
    bad.length
      ? check("hard.shadow", "hardening", "Permisos de /etc/shadow y otros", "bad", `${plural(bad.length, "archivo clave tiene", "archivos clave tienen")} permisos de más`, {
          weight: 3,
          items: bad,
          fix: fix(cmds.join("\n")),
        })
      : check("hard.shadow", "hardening", "Permisos de /etc/shadow y otros", "ok", "shadow, passwd, sudoers y sshd_config con permisos correctos", { weight: 3 }),
  );

  const ww = lines(ctx, "wwetc");
  const partial = ctx.elevated ? "" : " (sin sudo no se ve todo)";
  out.push(
    ww.length
      ? check("hard.wwetc", "hardening", "Archivos de /etc escribibles por todos", "bad", `${plural(ww.length, "archivo o carpeta", "archivos o carpetas")} de /etc que cualquiera puede cambiar`, {
          weight: 2,
          items: ww,
          fix: fix(`chmod o-w ${ww.map(shQuote).join(" ")}`),
        })
      : check("hard.wwetc", "hardening", "Archivos de /etc escribibles por todos", "ok", `Ninguno${partial}`, { weight: 2 }),
  );

  const wp = lines(ctx, "webperm");
  const dirs = wp.filter((l) => l.startsWith("@dir ")).map((l) => l.slice(5));
  const files = wp.filter((l) => !l.startsWith("@"));
  const caddyGroup = wp.includes("@group caddy");
  if (!dirs.length) out.push(check("hard.webconf", "hardening", "Configuración web legible por todos", "info", "No hay nginx, Caddy ni Apache en /etc"));
  else if (!files.length) out.push(check("hard.webconf", "hardening", "Configuración web legible por todos", "ok", "Solo la leen root y el servicio", { weight: 1 }));
  else {
    const keys = files.filter((f) => /(\.key|privkey[^/]*)$/.test(f));
    const touched = dirs.filter((d) => files.some((f) => f.startsWith(`${d}/`)));
    const cmds2 = touched.map((d) =>
      d === "/etc/caddy" ? (caddyGroup ? "chgrp -R caddy /etc/caddy && chmod -R g+rX,o-rwx /etc/caddy" : "# Caddy lee su configuración como «caddy»: dale el grupo antes de quitar permisos") : `chmod -R o-rwx ${d}`,
    );
    out.push(
      check(
        "hard.webconf",
        "hardening",
        "Configuración web legible por todos",
        keys.length ? "bad" : "warn",
        keys.length ? `${plural(keys.length, "llave privada", "llaves privadas")} de la web que cualquier usuario puede leer` : `${plural(files.length, "archivo", "archivos")} de configuración web que cualquier usuario puede leer`,
        {
          weight: keys.length ? 3 : 1,
          items: files,
          fix: fix(cmds2.join("\n"), { danger: true, manual: cmds2.some((c) => c.startsWith("#")), note: "Después, comprueba que el sitio responde" }),
        },
      ),
    );
  }

  const cron = lines(ctx, "cron");
  if (cron.includes("@noread")) out.push(check("hard.cron", "hardening", "Tareas cron de usuarios", "skip", NEEDS_SUDO));
  else {
    const others = cron.filter((u) => u !== "root");
    out.push(
      others.length
        ? check("hard.cron", "hardening", "Tareas cron de usuarios", "info", `${plural(others.length, "usuario tiene", "usuarios tienen")} tareas cron propias: revisa que las reconoces`, {
            items: others.map((u) => `${u}: crontab -l -u ${u}`),
          })
        : check("hard.cron", "hardening", "Tareas cron de usuarios", "ok", "Solo root tiene tareas cron propias"),
    );
  }
  return out;
}
