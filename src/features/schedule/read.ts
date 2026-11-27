// Tareas programadas: un script de solo lectura (crontab de cada usuario con sudo, /etc/crontab,
// /etc/cron.d, las carpetas cron.daily… y los timers de systemd) y su lectura. Cada línea de contenido va
// con «|» delante: así ningún archivo puede fingir una marca de sección.
import { splitSections } from "../../lib/remote";
import { sessionCache } from "../admin";
import { readElevated, refreshPrivilege, sudoRejected, type Elevation } from "../privileges";
import { parseCrontab, type CronJob } from "./crontab";
import { parseTimers, type Timer } from "./timers";

export const SCHEDULE_SCRIPT = [
  "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin; export PATH; LC_ALL=C; export LC_ALL",
  "echo @@me; id -un",
  "echo @@root; id -u",
  "echo @@tool; command -v crontab >/dev/null 2>&1 && echo crontab",
  "SD=; command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] && SD=1",
  "echo @@daemon",
  "if [ -n \"$SD\" ]; then for s in crond cron cronie; do [ \"$(systemctl is-active $s 2>/dev/null)\" = active ] && echo \"$s\"; done; fi",
  "if command -v pgrep >/dev/null 2>&1; then for p in crond cron; do pgrep -x $p >/dev/null 2>&1 && echo \"proc $p\"; done; fi",
  "echo @@humans",
  "{ getent passwd 2>/dev/null || cat /etc/passwd; } | awk -F: '$3>=1000 && $3<60000 {print $1}'",
  "L=$(id -un)",
  "if [ \"$(id -u)\" = 0 ]; then for d in /var/spool/cron/crontabs /var/spool/cron /etc/crontabs; do [ -d \"$d\" ] || continue",
  "  for f in \"$d\"/*; do [ -f \"$f\" ] && L=\"$L",
  "${f##*/}\"; done; done; fi",
  "if command -v crontab >/dev/null 2>&1; then printf '%s\\n' \"$L\" | sort -u | while read -r u; do",
  "  case $u in ''|cron.update|*[!A-Za-z0-9._-]*) continue;; esac",
  "  if [ \"$(id -u)\" = 0 ]; then o=$(crontab -l -u \"$u\" 2>/dev/null); r=$?; else o=$(crontab -l 2>/dev/null); r=$?; fi",
  "  if [ $r = 0 ]; then echo \"@@tab $u\"; printf '%s\\n' \"$o\" | sed 's/^/|/'; else echo \"@@notab $u\"; fi",
  "done; fi",
  "for f in /etc/crontab /etc/cron.d/*; do [ -f \"$f\" ] || continue",
  "  if [ -r \"$f\" ]; then echo \"@@sys $f\"; sed 's/^/|/' \"$f\"; else echo \"@@noread $f\"; fi",
  "done",
  "for d in /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly /etc/periodic/15min /etc/periodic/hourly /etc/periodic/daily /etc/periodic/weekly /etc/periodic/monthly; do",
  "  [ -d \"$d\" ] && { echo \"@@dir $d\"; ls -1 \"$d\" 2>/dev/null | sed 's/^/|/'; }",
  "done",
  "if [ -n \"$SD\" ]; then echo '@@timers'",
  "  T=$( { systemctl list-units --type=timer --all --no-legend --plain --no-pager; systemctl list-unit-files --type=timer --no-legend --no-pager; } 2>/dev/null | awk '{print $1}' | grep '\\.timer$' | grep -v '@\\.timer$' | sort -u)",
  "  [ -n \"$T\" ] && systemctl show $T -p Id -p Description -p ActiveState -p UnitFileState -p NextElapseUSecRealtime -p LastTriggerUSec -p Unit -p TimersCalendar -p TimersMonotonic --no-pager 2>/dev/null | sed 's/^/|/'",
  "fi",
  "echo @@end",
].join("\n");

export interface UserCrontab {
  user: string;
  /** Líneas tal cual (para reescribir sin perder ninguna); null = no tiene crontab. */
  lines: string[] | null;
  jobs: CronJob[];
}

export interface SystemCronFile {
  path: string;
  /** null = no se pudo leer (sin sudo). */
  jobs: CronJob[] | null;
}

export interface ScheduleRead {
  me: string | null;
  root: boolean;
  hasCrontab: boolean;
  /** Algo de cron en marcha (null = no se sabe: sin systemd ni pgrep). */
  daemon: string | null;
  humans: string[];
  crontabs: UserCrontab[];
  system: SystemCronFile[];
  /** Carpetas cron.daily… con sus scripts. */
  dirs: { path: string; scripts: string[] }[];
  /** null = sin systemd. */
  timers: Timer[] | null;
  elevationError: string | null;
}

const body = (lines: string[]) => lines.map((l) => (l.startsWith("|") ? l.slice(1) : l));

/** Salida de SCHEDULE_SCRIPT. */
export function parseSchedule(stdout: string): Omit<ScheduleRead, "elevationError"> {
  const s = splitSections(stdout, { header: "prefix", blank: "keep" });
  const first = (k: string) => (s.get(k) ?? []).find((l) => l.trim())?.trim() ?? null;
  const crontabs: UserCrontab[] = [];
  const system: SystemCronFile[] = [];
  const dirs: { path: string; scripts: string[] }[] = [];
  for (const [k, v] of s) {
    const sp = k.indexOf(" ");
    if (sp < 0) continue;
    const [kind, name] = [k.slice(0, sp), k.slice(sp + 1)];
    if (kind === "tab") {
      const lines = body(v);
      crontabs.push({ user: name, lines, jobs: parseCrontab(lines) });
    } else if (kind === "notab") crontabs.push({ user: name, lines: null, jobs: [] });
    else if (kind === "sys") system.push({ path: name, jobs: parseCrontab(body(v), true) });
    else if (kind === "noread") system.push({ path: name, jobs: null });
    else if (kind === "dir") dirs.push({ path: name, scripts: body(v).filter((x) => x.trim()) });
  }
  const daemon = (s.get("daemon") ?? []).map((l) => l.trim()).filter(Boolean);
  return {
    me: first("me"),
    root: first("root") === "0",
    hasCrontab: first("tool") === "crontab",
    daemon: daemon.length ? daemon[0].replace(/^proc /, "") : null,
    humans: (s.get("humans") ?? []).map((l) => l.trim()).filter(Boolean),
    crontabs: crontabs.sort((a, b) => Number(!!b.lines) - Number(!!a.lines) || a.user.localeCompare(b.user)),
    system,
    dirs,
    timers: s.has("timers") ? parseTimers(body(s.get("timers") ?? [])) : null,
  };
}

export const scheduleCache = sessionCache<ScheduleRead>();

export function loadSchedule(sessionId: string, el: Elevation | null): Promise<void> {
  return scheduleCache.load(sessionId, async () => {
    const r = await readElevated(sessionId, SCHEDULE_SCRIPT, el, 40);
    if (r.elevationError?.failure === "need-password") refreshPrivilege(sessionId);
    if (r.elevationError?.failure === "bad-password") sudoRejected(sessionId);
    return { ...parseSchedule(r.result.stdout), elevationError: r.elevationError?.message ?? null };
  });
}
