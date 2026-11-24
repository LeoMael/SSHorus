// Comprobaciones de la auditoría: entrada fina que coordina los módulos por categoría y reexporta sus helpers.
// Funciones puras (sin React ni Tauri): se prueban en audit.test.ts con salidas de Rocky, Debian y Alpine.
//
// Regla de privacidad: `detail` no lleva nombres de usuario, direcciones ni rutas de casa (va a la IA);
// todo eso va en `items`, que solo se ve en este equipo.
import type { Check } from "../../api/audit";
import { splitSections } from "../../lib/remote";
import { familyOf, type AuditCtx, type AuditInput } from "./checksCommon";
import { hardeningChecks } from "./checksHardening";
import { isolationChecks } from "./checksIsolation";
import { netChecks, sshChecks, userChecks } from "./checksSshNet";
import { containerChecks, loginChecks, systemChecks, updateChecks, webChecks } from "./checksSystem";

export { familyOf, parsePasswdLines, sudoUsers, type AuditCtx, type AuditInput } from "./checksCommon";
export { parseFirewall, parseSshd, sshdFixCommand, type FirewallState, type SshdConfig } from "./checksSshNet";
export { parseContainersAudit, parseDf, parseMem, type ContainerRow } from "./checksSystem";
export { isolationChecks } from "./checksIsolation";

export function buildContext(stdout: string, elevated: boolean): AuditCtx {
  const sec = splitSections(stdout);
  const idl = (sec.get("id") ?? [])[0]?.split(" ") ?? [];
  const uid = /^\d+$/.test(idl[0] ?? "") ? Number(idl[0]) : null;
  const osl = ((sec.get("os") ?? [])[0] ?? "").split("|");
  const os = { id: osl[0] ?? "", like: (osl[1] ?? "").split(/\s+/).filter(Boolean), name: osl[2] ?? "" };
  return {
    sec,
    uid,
    user: idl[1] ?? "",
    groups: ((sec.get("id") ?? [])[1] ?? "").split(/\s+/).filter(Boolean),
    os,
    family: familyOf(os.id, os.like),
    elevated: elevated || uid === 0,
    sshPort: 22,
    passwordAuth: null,
  };
}

export function runChecks(input: AuditInput): { checks: Check[]; os: string } {
  const ctx = buildContext(input.stdout, input.elevated);
  // El orden importa: SSH fija el puerto y si se entra con contraseña (lo usan Red y fail2ban).
  const checks = [
    ...sshChecks(ctx),
    ...userChecks(ctx),
    ...netChecks(ctx, input.ports),
    ...updateChecks(ctx, input.vuln, input.now),
    ...webChecks(input.web, input.now),
    ...containerChecks(ctx),
    ...systemChecks(ctx),
    ...loginChecks(ctx),
    ...hardeningChecks(ctx),
    ...isolationChecks(ctx, input.ports),
  ];
  return { checks, os: ctx.os.name || ctx.os.id };
}
