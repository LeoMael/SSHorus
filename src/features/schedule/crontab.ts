// Líneas de un crontab: entenderlas (tarea, variable, comentario), cambiar UNA sin tocar las demás y
// volver a escribir el crontab entero con copia de seguridad y comprobando que nadie lo cambió desde que
// se leyó. Funciones puras.
import { shQuote } from "../../lib/remote";
import type { ConfigChange } from "../serverConfig";
import { describeSchedule } from "./cronExpr";

/** Marca con la que SSHorus «pausa» una tarea (la comenta sin perderla). */
export const PAUSE_MARK = "#pausada: ";

export interface CronJob {
  /** Posición en el archivo (las líneas no se renumeran: así se cambia solo esa). */
  index: number;
  schedule: string;
  /** Usuario con el que corre (solo /etc/crontab y /etc/cron.d). */
  user: string | null;
  command: string;
  paused: boolean;
  /** «Cada día a las 3:00» (o el error si el horario está mal). */
  text: string;
  valid: boolean;
}

const SPECIAL_RE = /^(@[a-z]+)\s+(.*)$/i;
const FIVE_RE = /^((?:\S+\s+){4}\S+)\s+(.*)$/;
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*\s*=/;

function parseJob(text: string, index: number, system: boolean, paused: boolean): CronJob | null {
  const m = SPECIAL_RE.exec(text) ?? FIVE_RE.exec(text);
  if (!m) return null;
  let rest = m[2];
  let user: string | null = null;
  if (system) {
    const u = /^(\S+)\s+(.*)$/.exec(rest);
    if (!u) return null;
    user = u[1];
    rest = u[2];
  }
  const d = describeSchedule(m[1]);
  // Una línea comentada cualquiera que «parece» un horario no se toma por tarea pausada si no es válida.
  if (paused && !d.ok) return null;
  return { index, schedule: m[1].replace(/\s+/g, " "), user, command: rest, paused, text: d.ok ? d.text : d.error, valid: d.ok };
}

/** Tareas del archivo (`system`: formato de /etc/crontab y /etc/cron.d, con usuario). */
export function parseCrontab(lines: string[], system = false): CronJob[] {
  const out: CronJob[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith(PAUSE_MARK.trim())) {
      const j = parseJob(line.slice(PAUSE_MARK.trim().length).trim(), i, system, true);
      if (j) out.push(j);
      return;
    }
    if (line.startsWith("#") || ENV_RE.test(line)) return;
    const j = parseJob(line, i, system, false);
    if (j) out.push(j);
  });
  return out;
}

export type CommandCheck = { ok: true; warning: string | null } | { ok: false; error: string };

/** El comando de una tarea: una sola línea; en cron «%» es un salto de línea si no va como «\%». */
export function checkCommand(cmd: string): CommandCheck {
  const c = cmd.trim();
  if (!c) return { ok: false, error: "Escribe el comando que se ejecutará" };
  if (/[\n\r\0]/.test(cmd)) return { ok: false, error: "El comando tiene que ir en una sola línea" };
  if (c.length > 900) return { ok: false, error: "El comando es demasiado largo para una línea de cron" };
  if (/(^|[^\\])%/.test(c)) return { ok: true, warning: "En cron «%» significa salto de línea: si es parte del comando (p. ej. en date +%F), escríbelo como «\\%»." };
  return { ok: true, warning: null };
}

export function jobLine(schedule: string, command: string, paused = false): string {
  return `${paused ? PAUSE_MARK : ""}${schedule.trim().replace(/\s+/g, " ")} ${command.trim()}`;
}

export type CronEdit =
  | { kind: "add"; line: string }
  | { kind: "replace"; index: number; line: string }
  | { kind: "remove"; index: number };

/** Aplica el cambio a las líneas leídas; el resto queda tal cual (comentarios, variables, vacías). */
export function applyEdit(lines: string[], e: CronEdit): string[] {
  if (e.kind === "add") {
    const out = [...lines];
    while (out.length && out[out.length - 1].trim() === "") out.pop();
    return [...out, e.line];
  }
  if (e.index < 0 || e.index >= lines.length) throw new Error("La línea ya no existe: vuelve a leer las tareas");
  return e.kind === "remove" ? lines.filter((_, i) => i !== e.index) : lines.map((l, i) => (i === e.index ? e.line : l));
}

const USER_RE = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,31}$/;

export function validCronUser(u: string): boolean {
  return USER_RE.test(u);
}

/** Carpeta de las copias de seguridad de los crontab (solo root puede leerla). */
export const CRON_BACKUP_DIR = "/var/backups/sshorus-cron";

/**
 * Pasos (como root) para escribir el crontab de `user`: copia del actual, comprobar que sigue igual que
 * `before` (lo leído) y escribir `after` entero con `crontab -u … -`.
 */
export function writeCrontabSteps(user: string, before: string[], after: string[]): string[] {
  const u = shQuote(user);
  const old = before.join("\n");
  const next = after.length ? `${after.join("\n")}\n` : "";
  return [
    `# Copia del crontab actual de ${user} en ${CRON_BACKUP_DIR}`,
    `mkdir -p ${CRON_BACKUP_DIR} && chmod 700 ${CRON_BACKUP_DIR}`,
    `b=${CRON_BACKUP_DIR}/${user}-$(date +%Y%m%d-%H%M%S)`,
    `crontab -l -u ${u} > "$b" 2>/dev/null || : > "$b"`,
    "# Si alguien lo cambió desde que se leyó, no se toca",
    `if [ "$(cat "$b")" != ${shQuote(old)} ]; then echo ${shQuote(`El crontab de ${user} cambió desde que se leyó: vuelve a leerlo`)} >&2; exit 1; fi`,
    `printf '%s' ${shQuote(next)} | crontab -u ${u} -`,
    'echo "Hecho. Copia del anterior: $b"',
  ];
}

/** El cambio listo para el diálogo (comando exacto, como root). */
export function cronChange(user: string, before: string[], e: CronEdit, title: string, explain: string): ConfigChange {
  if (!validCronUser(user)) throw new Error(`Nombre de usuario no válido: ${user}`);
  const after = applyEdit(before, e);
  return {
    id: `cron:${user}:${e.kind}:${"index" in e ? e.index : after.length}`,
    label: title,
    title,
    explain,
    steps: writeCrontabSteps(user, before, after),
    danger: false,
    note: `Se reescribe el crontab entero con las demás líneas igual. La copia queda en ${CRON_BACKUP_DIR}.`,
    guardCheck: null,
    timeoutSecs: 60,
  };
}
