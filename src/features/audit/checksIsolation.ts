// Comprobaciones de «Qué pueden ver tus usuarios» (aislamiento de usuarios sin sudo) dentro de la auditoría.
// Regla de privacidad: `detail` no lleva nombres de usuario, direcciones ni rutas (eso solo va en `items`).
import type { Check } from "../../api/audit";
import type { PortsResult } from "../admin/ports";
import { shQuote } from "../admin/shell";
import { noTunnelsNonAdminSteps } from "../admin/sshdConf";
import { classifyLocalServices, NO_LOGIN_SHELL, openTunnelFlags, parseSshTunnels } from "../admin/userVisibility";
import { check, fix, lines, NEEDS_SUDO, parsePasswdLines, plural, sudoUsers, type AuditCtx } from "./checksCommon";

export function isolationChecks(ctx: AuditCtx, ports: PortsResult | null): Check[] {
  const passwd = parsePasswdLines(lines(ctx, "passwd"));
  const admins = new Set(["root", ...sudoUsers(lines(ctx, "groups"), lines(ctx, "sudoers"))]);
  const nonAdmins = passwd.filter((u) => u.uid >= 1000 && u.uid < 65534 && !NO_LOGIN_SHELL.test(u.shell) && !admins.has(u.name));
  const nonAdminNames = new Set(nonAdmins.map((u) => u.name));

  const out: Check[] = [];

  // 1. Túneles SSH de usuarios sin sudo.
  const tun = parseSshTunnels(lines(ctx, "sshtun"));
  if (!nonAdmins.length) {
    out.push(check("iso.tunnels", "isolation", "Túneles SSH de usuarios sin sudo", "ok", "No hay usuarios humanos sin sudo en este servidor", { weight: 2 }));
  } else if (tun.state === "nosshd") {
    out.push(check("iso.tunnels", "isolation", "Túneles SSH de usuarios sin sudo", "ok", "No hay sshd instalado", { weight: 2 }));
  } else if (tun.state === "noread" || !ctx.sec.has("sshtun")) {
    out.push(check("iso.tunnels", "isolation", "Túneles SSH de usuarios sin sudo", "skip", `${NEEDS_SUDO} (sshd -T -C)`, { weight: 2 }));
  } else {
    const openUsers: string[] = [];
    for (const u of nonAdmins) {
      const caps = tun.map.get(u.name);
      if (!caps) continue;
      const flags = openTunnelFlags(caps);
      if (flags.length) openUsers.push(`${u.name}: ${flags.join(", ")}`);
    }
    const adminGroups = lines(ctx, "groups")
      .map((l) => l.split(":")[0])
      .filter(Boolean);
    out.push(
      openUsers.length
        ? check(
            "iso.tunnels",
            "isolation",
            "Túneles SSH de usuarios sin sudo",
            "warn",
            `${plural(openUsers.length, "usuario sin sudo puede", "usuarios sin sudo pueden")} abrir túneles SSH hacia servicios internos`,
            {
              weight: 2,
              items: openUsers,
              fix: fix(noTunnelsNonAdminSteps(adminGroups).join("\n"), {
                danger: true,
                note: "Cierra túneles SSH solo a los usuarios sin sudo (root y administradores siguen igual)",
              }),
            },
          )
        : check("iso.tunnels", "isolation", "Túneles SSH de usuarios sin sudo", "ok", "Ningún usuario sin sudo puede abrir túneles SSH", { weight: 2 }),
    );
  }

  // 2. Carpetas HOME legibles por otros usuarios.
  const openHomes: { path: string; mode: string }[] = [];
  for (const l of lines(ctx, "homes")) {
    const [, path, modeS] = l.split("|");
    const mode = Number.parseInt(modeS ?? "", 8);
    if (path && Number.isFinite(mode) && (mode & 0o005) !== 0) openHomes.push({ path, mode: modeS });
  }
  if (ctx.sec.has("homes")) {
    out.push(
      openHomes.length
        ? check(
            "iso.homes",
            "isolation",
            "Carpetas personales (HOME) abiertas",
            "warn",
            `${plural(openHomes.length, "carpeta personal es", "carpetas personales son")} visibles para otros usuarios`,
            {
              weight: 1,
              items: openHomes.map((h) => `${h.path} (permisos ${h.mode})`),
              fix: fix(`chmod 700 ${openHomes.map((h) => shQuote(h.path)).join(" ")}`),
            },
          )
        : check("iso.homes", "isolation", "Carpetas personales (HOME) abiertas", "ok", "Las carpetas personales están cerradas a otros usuarios", { weight: 1 }),
    );
  }

  // 3. Servicios internos en 127.0.0.1 accesibles desde cualquier shell local.
  const local = classifyLocalServices(ports);
  const noAuth = local.filter((s) => s.likelyNoAuth);
  if (nonAdmins.length > 0 && ports) {
    if (noAuth.length > 0) {
      out.push(
        check(
          "iso.local",
          "isolation",
          "Servicios internos accesibles en local",
          "warn",
          `${plural(noAuth.length, "servicio interno suele", "servicios internos suelen")} escucharse sin contraseña desde cualquier shell local`,
          {
            weight: 2,
            items: local.map((s) => s.label),
            fix: fix("# Activa contraseña/autenticación en estos servicios o muévelos a sockets Unix con permisos de grupo", { manual: true }),
          },
        ),
      );
    } else if (local.length > 0) {
      out.push(
        check(
          "iso.local",
          "isolation",
          "Servicios internos accesibles en local",
          "info",
          `${plural(local.length, "servicio escucha", "servicios escuchan")} en local: revisa que pidan contraseña`,
          { items: local.map((s) => s.label) },
        ),
      );
    } else {
      out.push(check("iso.local", "isolation", "Servicios internos accesibles en local", "ok", "No hay servicios internos expuestos en local", { weight: 1 }));
    }
  }

  // 4. Acceso a Docker o contenedores de otros usuarios sin sudo.
  const isoGroups = new Map<string, string[]>();
  for (const l of lines(ctx, "isogroups")) {
    const [g, , , members = ""] = l.split(":");
    if (g) isoGroups.set(g, members.split(",").map((x) => x.trim()).filter(Boolean));
  }
  const dockerNonAdmins = (isoGroups.get("docker") ?? []).filter((u) => nonAdminNames.has(u));
  let worldDockerSock: string | null = null;
  const openRunDirs: string[] = [];
  for (const l of lines(ctx, "dockersock")) {
    if (l.startsWith("@sock ")) {
      const [path, modeS] = l.slice(6).split("|");
      const mode = Number.parseInt(modeS ?? "", 8);
      if (path && Number.isFinite(mode) && (mode & 0o006) !== 0) worldDockerSock = path;
    } else if (l.startsWith("@run ")) {
      const [path, modeS] = l.slice(5).split("|");
      const mode = Number.parseInt(modeS ?? "", 8);
      if (path && Number.isFinite(mode) && (mode & 0o005) !== 0) openRunDirs.push(path);
    }
  }
  const dockerItems = [
    ...dockerNonAdmins.map((u) => `${u}: pertenece al grupo docker (equivale a root)`),
    ...(worldDockerSock ? [`${worldDockerSock}: abierto a cualquier usuario`] : []),
    ...openRunDirs.map((d) => `${d}: carpeta de contenedores abierta a otros`),
  ];
  if (ctx.sec.has("dockersock") || dockerNonAdmins.length) {
    const cmds = [
      ...(worldDockerSock ? [`chmod 660 ${shQuote(worldDockerSock)}`] : []),
      ...(openRunDirs.length ? [`chmod 700 ${openRunDirs.map(shQuote).join(" ")}`] : []),
      ...dockerNonAdmins.map((u) => `gpasswd -d ${shQuote(u)} docker`),
    ];
    out.push(
      dockerItems.length
        ? check(
            "iso.docker",
            "isolation",
            "Contenedores de otros y socket de Docker",
            dockerNonAdmins.length || worldDockerSock ? "bad" : "warn",
            dockerNonAdmins.length || worldDockerSock
              ? "Usuarios sin sudo tienen acceso al socket de Docker (equivale a root)"
              : `${plural(openRunDirs.length, "carpeta de contenedores está", "carpetas de contenedores están")} abierta a otros usuarios`,
            {
              weight: dockerNonAdmins.length || worldDockerSock ? 3 : 1,
              items: dockerItems,
              fix: cmds.length ? fix(cmds.join("\n"), { danger: dockerNonAdmins.length > 0 }) : null,
            },
          )
        : check("iso.docker", "isolation", "Contenedores de otros y socket de Docker", "ok", "Sin usuarios sin sudo en Docker ni carpetas de contenedores abiertas", { weight: 2 }),
    );
  }

  // 5. Logs sensibles y cron legibles por usuarios sin sudo.
  const logNonAdmins = [...new Set([...(isoGroups.get("adm") ?? []), ...(isoGroups.get("systemd-journal") ?? [])])].filter((u) => nonAdminNames.has(u));
  const worldLogs = lines(ctx, "cronlogs").filter((l) => l.startsWith("@log ")).map((l) => l.slice(5));
  const worldCron = lines(ctx, "cronlogs").filter((l) => l.startsWith("@cron ")).map((l) => l.slice(6));
  const logItems = [...logNonAdmins.map((u) => `${u}: pertenece a adm/systemd-journal`), ...worldLogs, ...worldCron];
  if (ctx.sec.has("cronlogs") || logNonAdmins.length) {
    const fileCmds = [...worldLogs, ...worldCron];
    out.push(
      logItems.length
        ? check(
            "iso.logs",
            "isolation",
            "Registros (logs) y cron legibles por otros",
            "warn",
            "Los usuarios sin sudo pueden leer registros del sistema o tareas cron ajenas",
            {
              weight: 1,
              items: logItems,
              fix: fileCmds.length
                ? fix(`chmod o-rwx ${fileCmds.map(shQuote).join(" ")}`)
                : fix("# Quita a los usuarios sin sudo de los grupos adm y systemd-journal si no deben leer logs", { manual: true }),
            },
          )
        : check("iso.logs", "isolation", "Registros (logs) y cron legibles por otros", "ok", "Logs sensibles y cron protegidos frente a otros usuarios", { weight: 1 }),
    );
  }

  return out;
}
