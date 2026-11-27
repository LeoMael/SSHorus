// Pruebas de Tareas programadas: horarios de cron en palabras y su validación, líneas de un crontab
// (tareas, variables, comentarios, pausadas, formato del sistema), cambiar una sin perder las demás,
// escribir el crontab de verdad con `sh` (un `crontab` de mentira) y los timers de systemd.
import { describeSchedule } from "./cronExpr";
import { applyEdit, checkCommand, cronChange, jobLine, parseCrontab, writeCrontabSteps } from "./crontab";
import { parseSchedule, SCHEDULE_SCRIPT } from "./read";
import { calendarText, timerActions, timerChange } from "./timers";

const CHILD = "node:child_process";
const { spawnSync } = (await import(/* @vite-ignore */ CHILD)) as {
  spawnSync: (cmd: string, args: string[], opts: { encoding: "utf8"; input?: string }) => { status: number | null; stdout: string; stderr: string };
};

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}
const text = (s: string) => {
  const r = describeSchedule(s);
  return r.ok ? r.text : `ERROR: ${r.error}`;
};

// ───────── Horarios en palabras ─────────
eq(text("0 3 * * *"), "Cada día a las 3:00", "cada día");
eq(text("*/5 * * * *"), "Cada 5 minutos", "cada 5 minutos");
eq(text("* * * * *"), "Cada minuto", "cada minuto");
eq(text("15 * * * *"), "Cada hora, en el minuto 15", "cada hora");
eq(text("0 3 * * 1"), "Los lunes a las 3:00", "los lunes");
eq(text("30 8 * * 1-5"), "De lunes a viernes a las 8:30", "laborables");
eq(text("0 0 1 * *"), "El día 1 de cada mes a las 0:00", "día 1");
eq(text("0 8,20 * * *"), "Cada día a las 8:00 y 20:00", "dos horas");
eq(text("0 */6 * * *"), "Cada 6 horas, en punto", "cada 6 horas");
eq(text("*/15 9-17 * * 1-5"), "Cada 15 minutos, de 9:00 a 17:59, de lunes a viernes", "cada 15 en horario de oficina");
eq(text("0 4 * * sun,sat"), "Los domingos y sábados a las 4:00", "nombres de días");
eq(text("0 0 1 jan *"), "El día 1 de enero a las 0:00", "mes por nombre");
eq(text("0 9 * 6-8 *"), "Cada día, de junio a agosto a las 9:00", "rango de meses");
eq(text("0 0 1,15 * 5"), "Los días 1 y 15 y también los viernes a las 0:00", "día del mes O de la semana");
eq(text("@daily"), "Cada día a las 0:00", "atajo");
eq(text("@reboot"), "Al encender el servidor", "al encender");
ok(text("60 * * * *").includes("fuera de 0–59"), "minuto 60");
ok(text("0 3 * *").includes("5 campos"), "faltan campos");
ok(text("@cadarato").includes("no es un atajo"), "atajo inventado");
ok(text("5-1 * * * *").includes("mayor"), "rango al revés");
ok(text("*/0 * * * *").includes("no vale"), "salto 0");

// ───────── Líneas de un crontab ─────────
const TAB = [
  "# Copias de la web",
  "MAILTO=leo@example.com",
  "",
  "0 3 * * * /usr/local/bin/backup.sh >/dev/null 2>&1",
  "#pausada: */10 * * * * curl -fsS https://example.com/ping",
  "# 1 2 3 4 5 esto es solo un comentario con números",
  "@reboot podman start web",
  "61 * * * * roto",
];
const jobs = parseCrontab(TAB);
eq(jobs.map((j) => [j.index, j.schedule, j.paused, j.valid]), [[3, "0 3 * * *", false, true], [4, "*/10 * * * *", true, true], [6, "@reboot", false, true], [7, "61 * * * *", false, false]], "tareas, pausada y una rota");
eq(jobs[0].text, "Cada día a las 3:00", "en palabras");
const sys = parseCrontab(["SHELL=/bin/bash", "17 * * * * root cd / && run-parts --report /etc/cron.hourly", "@daily  www-data /usr/bin/php /var/www/cron.php"], true);
eq(sys.map((j) => [j.user, j.command]), [["root", "cd / && run-parts --report /etc/cron.hourly"], ["www-data", "/usr/bin/php /var/www/cron.php"]], "formato del sistema (con usuario)");

// ───────── Cambiar una línea sin perder las demás ─────────
const replaced = applyEdit(TAB, { kind: "replace", index: 3, line: jobLine("30 2 * * *", "/usr/local/bin/backup.sh") });
eq(replaced.filter((l, i) => l !== TAB[i]), ["30 2 * * * /usr/local/bin/backup.sh"], "solo cambia esa línea");
eq(applyEdit(TAB, { kind: "remove", index: 4 }).length, TAB.length - 1, "borrar una");
eq(applyEdit(["a", "", ""], { kind: "add", line: "b" }), ["a", "b"], "añadir al final (sin vacías de más)");
eq(applyEdit(TAB, { kind: "replace", index: 4, line: jobLine("*/10 * * * *", "curl -fsS https://example.com/ping") })[4], "*/10 * * * * curl -fsS https://example.com/ping", "reanudar");
ok(jobLine("0 1 * * *", "x", true).startsWith("#pausada: 0 1"), "pausar");
let threw = false;
try {
  applyEdit(TAB, { kind: "remove", index: 99 });
} catch {
  threw = true;
}
ok(threw, "línea que ya no existe");
ok(!checkCommand("").ok && !checkCommand("a\nb").ok, "comando vacío o de dos líneas");
const pct = checkCommand("tar czf /b/$(date +%F).tgz /srv");
ok(pct.ok && pct.warning?.includes("\\%"), "aviso del %");
ok(checkCommand("date +\\%F").ok && (checkCommand("date +\\%F") as { warning: string | null }).warning === null, "\\% ya escapado");
let badUser = false;
try {
  cronChange("a;b", [], { kind: "add", line: "x" }, "t", "e");
} catch {
  badUser = true;
}
ok(badUser, "usuario no válido");

// ───────── Escribir de verdad (con un crontab de mentira) ─────────
const fake = (store: string) =>
  `crontab() { case "$1" in -l) [ -f ${store} ] && cat ${store} || return 1;; -u) if [ "$3" = - ]; then cat > ${store}; else [ -f ${store} ] && cat ${store} || return 1; fi;; esac; }\n` +
  `mkdir() { :; }\nchmod() { :; }\n`;
const run = (script: string) => spawnSync("sh", ["-e"], { encoding: "utf8", input: script });
const tmp = spawnSync("mktemp", ["-d"], { encoding: "utf8" }).stdout.trim();
const store = `${tmp}/tab`;
const before = ["MAILTO=x", "0 3 * * * a 'b' \"c\" $HOME"];
const after = applyEdit(before, { kind: "add", line: "@reboot d" });
const steps = writeCrontabSteps("ana", before, after).map((s) => s.replace("/var/backups/sshorus-cron", tmp));
spawnSync("sh", ["-c", `printf '%s\\n' 'MAILTO=x' "0 3 * * * a 'b' \\"c\\" \\$HOME" > ${store}`], { encoding: "utf8" });
const w = run(`${fake(store)}${steps.join("\n")}`);
ok(w.status === 0, `escribir: ${w.stderr}`);
eq(spawnSync("cat", [store], { encoding: "utf8" }).stdout, "MAILTO=x\n0 3 * * * a 'b' \"c\" $HOME\n@reboot d\n", "crontab nuevo con las líneas de antes intactas");
ok(/Copia del anterior/.test(w.stdout), "deja copia");
const again = run(`${fake(store)}${steps.join("\n")}`);
ok(again.status !== 0 && /cambió desde que se leyó/.test(again.stderr), "si cambió desde que se leyó, no se toca");
spawnSync("rm", ["-rf", tmp], { encoding: "utf8" });

// ───────── Lectura completa ─────────
const read = parseSchedule(
  [
    "@@me", "leo", "@@root", "0", "@@tool", "crontab", "@@daemon", "crond", "@@humans", "leo", "ana",
    "@@tab root", "|# tareas de root", "|", "|0 4 * * * /usr/bin/dnf -y makecache",
    "@@notab ana",
    "@@tab leo", "|*/5 * * * * /home/leo/check.sh",
    "@@sys /etc/crontab", "|SHELL=/bin/bash", "|17 * * * * root run-parts /etc/cron.hourly",
    "@@noread /etc/cron.d/secreto",
    "@@dir /etc/cron.daily", "|logrotate", "|man-db",
    "@@timers",
    "|Id=dnf-makecache.timer", "|Description=dnf makecache --timer", "|ActiveState=active", "|UnitFileState=enabled",
    "|NextElapseUSecRealtime=Thu 2026-11-26 12:41:12 UTC", "|LastTriggerUSec=Thu 2026-11-26 11:30:01 UTC", "|Unit=dnf-makecache.service",
    "|TimersCalendar=", "|TimersMonotonic={ OnBootUSec=10min ; next_elapse=0 } { OnUnitInactiveUSec=1h ; next_elapse=0 }",
    "|",
    "|Id=logrotate.timer", "|Description=Daily rotation of log files", "|ActiveState=inactive", "|UnitFileState=disabled",
    "|NextElapseUSecRealtime=", "|LastTriggerUSec=n/a", "|Unit=logrotate.service",
    "|TimersCalendar={ OnCalendar=*-*-* 00:00:00 ; next_elapse=Fri 2026-11-27 00:00:00 UTC }", "|TimersMonotonic=",
    "@@end",
  ].join("\n"),
);
eq(read.crontabs.map((c) => [c.user, c.lines?.length ?? null, c.jobs.length]), [["leo", 1, 1], ["root", 3, 1], ["ana", null, 0]], "crontab por usuario (líneas vacías incluidas)");
eq(read.crontabs[1].lines, ["# tareas de root", "", "0 4 * * * /usr/bin/dnf -y makecache"], "el contenido tal cual");
eq([read.system.length, read.system[0].jobs?.[0].user, read.system[1].jobs], [2, "root", null], "/etc/crontab y uno sin permiso");
eq(read.dirs, [{ path: "/etc/cron.daily", scripts: ["logrotate", "man-db"] }], "cron.daily");
eq([read.daemon, read.root, read.humans], ["crond", true, ["leo", "ana"]], "demonio, root y usuarios");
const t = read.timers ?? [];
eq(t.map((x) => [x.unit, x.active, x.next, x.last]), [["dnf-makecache.timer", true, "Thu 2026-11-26 12:41:12 UTC", "Thu 2026-11-26 11:30:01 UTC"], ["logrotate.timer", false, null, null]], "timers");
eq(t[0].when, "10min después de encender · 1h después de que termine la última vez", "timer monotónico");
eq(t[1].when, "Cada día a las 0:00", "timer de calendario");
eq(parseSchedule("@@me\nroot\n@@end\n").timers, null, "sin systemd: no aplica");
eq(calendarText("Mon..Fri *-*-* 08:30:00"), "De lunes a viernes a las 8:30", "calendario laborables");
eq(calendarText("*-*-01 04:00:00"), "El día 1 de cada mes a las 4:00", "calendario mensual");
eq(calendarText("*-*-* *:00:00"), "Cada hora, en punto", "calendario cada hora");
eq(calendarText("Sat *-*-1..7 18:00:00"), "Sat *-*-1..7 18:00:00", "lo raro, tal cual");
eq(timerActions(t[0]), ["disable", "run"], "acciones de un timer activo");
eq(timerChange(t[1], "enable")?.steps, ["systemctl enable --now 'logrotate.timer'"], "activar timer");
eq(timerChange(t[0], "run")?.steps, ["systemctl start 'dnf-makecache.service'"], "ejecutar ahora");
eq(timerChange({ ...t[0], unit: "$(x).timer" }, "run"), null, "nombre raro");
const sn = spawnSync("sh", ["-n"], { encoding: "utf8", input: SCHEDULE_SCRIPT });
ok(sn.status === 0, `SCHEDULE_SCRIPT: sh -n falló: ${sn.stderr}`);

console.log(`tareas programadas: ${passed} pruebas bien`);
