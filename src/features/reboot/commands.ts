// Comandos de «Reiniciar ahora»: el que reinicia (como root) y la lectura del estado antes y después
// (sin root). Funciones puras.
import { splitSections } from "../../lib/remote";
import type { PrivilegeInfo } from "../privileges";
import { REBOOT_PENDING_LINES, rebootPending, type RebootPendingInfo } from "./detect";

/** Con qué se eleva: "" = ya es root. */
export type RebootTool = "" | "sudo" | "doas";

/**
 * Lo que se ejecuta como root: systemctl reboot (con systemd), si no shutdown -r now, si no reboot.
 * Se lanza aparte y con un segundo de margen: así la orden responde en seguida y el corte de la
 * conexión llega después, cuando SSHorus ya sabe que el reinicio está en marcha.
 */
const INNER =
  'PATH=$PATH:/usr/sbin:/sbin; if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then c="systemctl reboot"; ' +
  'elif command -v shutdown >/dev/null 2>&1; then c="shutdown -r now"; else c=reboot; fi; ' +
  'nohup sh -c "sleep 1; $c" >/dev/null 2>&1 </dev/null & echo @@sent';

/** Comando completo (se muestra antes de confirmar). */
export function rebootCommand(tool: RebootTool): string {
  const run = `sh -c '${INNER}'`;
  return tool ? `${tool} ${run}` : run;
}

/** La orden se aceptó (el servidor va a reiniciarse). */
export function rebootSent(stdout: string): boolean {
  return splitSections(stdout).has("sent");
}

/** Con qué se puede reiniciar o por qué no. */
export function rebootAccess(info: PrivilegeInfo | null): { tool: RebootTool; why: null } | { tool: null; why: string } {
  if (!info) return { tool: null, why: "Comprobando tus privilegios…" };
  if (info.level === "root") return { tool: "", why: null };
  if (info.level === "sudo-nopasswd" && info.tool) return { tool: info.tool, why: null };
  if (info.hasSudo || info.level === "unknown") return { tool: "sudo", why: null };
  if (info.tool === "doas") return { tool: null, why: "doas con contraseña no se puede usar desde aquí: reinicia desde la terminal" };
  return { tool: null, why: "Necesitas root o sudo para reiniciar el servidor" };
}

/**
 * Lectura sin root: arranque actual y tiempo encendido; con `pending`, también si pide reiniciarse
 * (needs-restarting puede tardar: antes de reiniciar no hace falta).
 */
export function statusScript(pending: boolean): string {
  return [
    "PATH=$PATH:/usr/sbin:/sbin; export PATH; LC_ALL=C; export LC_ALL",
    "TO=''; command -v timeout >/dev/null 2>&1 && TO='timeout 20'",
    "echo @@boot; cat /proc/sys/kernel/random/boot_id 2>/dev/null",
    "echo @@up; cut -d' ' -f1 /proc/uptime 2>/dev/null",
    ...(pending ? ["echo @@reboot", ...REBOOT_PENDING_LINES] : []),
    "echo @@end",
  ].join("\n");
}

export interface ServerStatus {
  /** Cambia en cada arranque (null si no se pudo leer). */
  bootId: string | null;
  uptimeSecs: number | null;
  pending: RebootPendingInfo;
}

export function parseStatus(stdout: string): ServerStatus {
  const s = splitSections(stdout);
  const bootId = s.get("boot")?.[0]?.trim() || null;
  const up = Number.parseFloat(s.get("up")?.[0] ?? "");
  return {
    bootId,
    uptimeSecs: Number.isFinite(up) ? Math.floor(up) : null,
    pending: rebootPending((s.get("reboot") ?? []).map((l) => l.trim())),
  };
}

/** ¿Se reinició entre `before` y `after`? null = no se sabe. */
export function rebootedBetween(before: ServerStatus | null, after: ServerStatus): boolean | null {
  if (before?.bootId && after.bootId) return before.bootId !== after.bootId;
  if (before?.uptimeSecs != null && after.uptimeSecs != null) return after.uptimeSecs < before.uptimeSecs;
  return null;
}
