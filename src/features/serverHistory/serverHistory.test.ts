// Pruebas del historial por servidor: la línea de la terminal (y los avisos de contraseña), la línea de
// tiempo (juntar, filtrar, contar), exportar y cómo quedan la Biblioteca y las tareas.
import type { AuditEntry } from "../../api/mcp";
import type { ExecResult } from "../../api/types";
import type { Job } from "../../stores/jobsState";
import { execResultText, firstLine, jobEvent, libraryEvent, tail } from "./events";
import { exportFileName, historyToJson, historyToText } from "./exportHistory";
import { logsTerminal } from "./prefs";
import { abandonsLine, commandFromLine, isSecretPrompt } from "./terminalLine";
import { countBySource, filterTimeline, fromAdmin, fromAi, fromAudit, fromEvent, mergeTimeline } from "./timeline";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) throw new Error(`${what}: ${a} ≠ ${b}`);
  passed++;
}

// ───────── Avisos que piden un secreto ─────────
for (const p of [
  "[sudo] password for leo: ",
  "[sudo] contraseña para leo:",
  "Password:",
  "leo@otro's password: ",
  "Enter passphrase for key '/home/leo/.ssh/id_ed25519': ",
  "Enter password:",
  "New password: ",
  "Retype new password:",
  "Enter PEM pass phrase:",
  "Verification code: ",
  "Introduzca la clave: ",
  "Password for 'https://ana@github.com': ",
])
  eq(isSecretPrompt(p), true, `aviso: ${p}`);
for (const p of ["", "leo@web:~$ ", "root@srv:/etc# ", "leo@pin-server:~$ ", "mysql> ", "PS> ", "leo@web ~/passwords$ "])
  eq(isSecretPrompt(p), false, `no es aviso: ${p}`);

// ───────── Comando a partir de la línea de la pantalla ─────────
const P = "leo@web:~$ ";
eq(commandFromLine(`${P}ls -la`, P), "ls -la", "comando normal");
eq(commandFromLine(`${P}  sudo systemctl restart nginx  `, P), "sudo systemctl restart nginx", "sin espacios a los lados");
eq(commandFromLine(P, P), null, "Enter en vacío");
eq(commandFromLine(`otra cosa ls`, P), null, "la pantalla cambió (clear, salida)");
eq(commandFromLine("[sudo] password for leo: ", "[sudo] password for leo: "), null, "tras el aviso de sudo nunca");
eq(commandFromLine("Password: ", ""), null, "aviso que llegó después de empezar a escribir");
eq(commandFromLine(`${P}x`.padEnd(P.length + 3000, "y"), P)?.length, 2000, "recorta los muy largos");
eq(abandonsLine("\u0003"), true, "Ctrl+C abandona la línea");
eq(abandonsLine("ls"), false, "texto normal");

// ───────── Ajuste por servidor ─────────
eq(logsTerminal({ all: false, servers: [] }, "a"), false, "apagado por defecto");
eq(logsTerminal({ all: false, servers: ["a"] }, "a"), true, "solo ese servidor");
eq(logsTerminal({ all: true, servers: [] }, "b"), true, "todos");

// ───────── Línea de tiempo ─────────
const ai: AuditEntry = {
  id: "1",
  at: 3000,
  tool: "run_command",
  serverId: "a",
  serverName: "web",
  detail: "uptime",
  status: "denied",
  approvedBy: "tú: denegado",
  message: null,
  durationMs: 4,
  client: "Claude Code",
};
const items = mergeTimeline([
  [fromAdmin({ id: "x", at: 1000, server: "web", action: "Reiniciar nginx", command: "systemctl restart nginx", ok: true, result: "" })],
  [fromAi(ai)],
  [fromEvent({ id: "e", at: 2000, source: "terminal", title: "df -h", detail: "", ok: null, result: "", serverName: "web" })],
  [fromAudit({ id: "r", createdAt: "1970-01-01T00:00:04.000Z", elevated: true, score: 81, grade: "B", bad: 2, warn: 1, hasAi: false })],
]);
eq(items.map((i) => i.source), ["audit", "ai", "terminal", "admin"], "lo más nuevo primero");
eq(items[1].who, "Claude Code", "quién: el asistente");
eq(items[1].ok, false, "denegado cuenta como fallo");
eq(items[0].title, "Auditoría: nota B (81/100)", "título de la auditoría");
const none = new Set<never>();
eq(filterTimeline(items, { sources: none, text: "", onlyErrors: true }).length, 2, "solo lo que falló");
eq(filterTimeline(items, { sources: new Set(["terminal"]), text: "", onlyErrors: false }).map((i) => i.title), ["df -h"], "por origen");
eq(filterTimeline(items, { sources: none, text: "claude uptime", onlyErrors: false }).length, 1, "buscar varias palabras");
eq(filterTimeline(items, { sources: none, text: "administracion", onlyErrors: false }).length, 1, "busca sin tildes y por origen");
eq(countBySource(items), { audit: 1, ai: 1, terminal: 1, admin: 1 }, "cuántas de cada uno");

// ───────── Exportar ─────────
const txt = historyToText(items.slice(2), "web", 0);
eq(txt.includes("Historial de web") && txt.includes("Terminal · Tú (terminal) · —") && txt.includes("systemctl restart nginx"), true, "texto");
const json = JSON.parse(historyToJson(items.slice(3), "web", 0)) as { server: string; entries: { source: string; ok: boolean }[] };
eq([json.server, json.entries[0].source, json.entries[0].ok], ["web", "admin", true], "JSON");
eq(exportFileName("web prod/1", "json", 0).replace(/\d{4}-\d{2}-\d{2}/, "F"), "historial-web-prod-1-F.json", "nombre de archivo");

// ───────── Biblioteca y tareas ─────────
const r = (o: Partial<ExecResult>): ExecResult => ({ stdout: "", stderr: "", exitCode: 0, durationMs: 1, truncated: false, timedOut: false, ...o });
eq(execResultText(r({ stdout: "hola\n" })), "Código de salida 0\nhola", "resultado");
eq(execResultText(r({ timedOut: true, exitCode: null })), "Se agotó el tiempo", "tiempo agotado");
eq(tail("abcdef", 3), "…def", "lo último");
eq(firstLine("a\nb"), "a …", "primera línea");
const lib = libraryEvent("", "uptime", { kind: "result", result: r({ exitCode: 1 }) }, "web");
eq([lib.title, lib.ok, lib.source], ["uptime", false, "library"], "Biblioteca sin nombre");
eq(libraryEvent("Ver discos", "df -h", { kind: "terminal" }, "web").ok, null, "enviado a la terminal");

const job = (o: Partial<Job>) =>
  ({ kind: "compose", status: "done", title: "Levantar", detail: "web", lines: ["ok"], summary: "Listo", error: null, server: "web", ...o }) as Job;
eq(jobEvent(job({}))?.title, "Levantar · web", "tarea terminada");
eq(jobEvent(job({ status: "failed", error: "falló" }))?.ok, false, "tarea fallida");
eq(jobEvent(job({ kind: "auditfix" })), null, "las que ya van a Administración no se repiten");
eq(jobEvent(job({ status: "running" })), null, "en marcha, todavía no");

console.log(`serverHistory: ${passed} pruebas correctas`);
