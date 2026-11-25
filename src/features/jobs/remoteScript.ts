// Scripts de las tareas largas: el comando va en un grupo de procesos propio y su número queda en un
// archivo, para que «Cancelar» pueda detener TODO (también lo que corre como otro usuario o como root,
// donde la señal del canal SSH no llega). Funciones puras.
import { shQuote } from "../../lib/remote";

const JOB_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Archivo con el número del grupo de procesos (lo crea y lo lee el mismo dueño). */
function pidFile(jobId: string): string {
  if (!JOB_ID_RE.test(jobId)) throw new Error("Identificador de tarea no válido");
  return `"\${TMPDIR:-/tmp}/sshorus-job-${jobId}.pid"`;
}

/**
 * Envuelve `body` (ya como su dueño): lo lanza con `setsid` (grupo nuevo), apunta el grupo y espera.
 * Si a este shell le llega TERM (cancelar por el canal), lo pasa a todo el grupo.
 */
export function jobScript(jobId: string, body: string): string {
  return [
    `pf=${pidFile(jobId)}`,
    "s=; if command -v setsid >/dev/null 2>&1; then s=setsid; fi",
    `$s sh -c 'echo $$ >"$0"; exec sh -c "$1"' "$pf" ${shQuote(body)} &`,
    "p=$!",
    `trap 'kill -TERM -$p 2>/dev/null || kill -TERM $p 2>/dev/null' TERM INT HUP`,
    'wait "$p"; rc=$?',
    'rm -f "$pf"',
    "exit $rc",
  ].join("\n");
}

/** Lo que escribe la parada si no pudo detener los procesos hijos (ver `killJobScript`). */
export const PARTIAL_STOP = "partial";

/**
 * Detiene la tarea (como su dueño): TERM a todo el grupo, espera hasta 10 s y luego KILL. Sin `setsid`
 * el comando no tiene grupo propio: entonces se para su árbol de procesos (hijos con `pgrep -P` o
 * leyendo /proc) y, si no hay forma de listarlos, solo el shell de la tarea, avisando con «partial».
 */
export function killJobScript(jobId: string): string {
  return [
    `pf=${pidFile(jobId)}`,
    'p=$(cat "$pf" 2>/dev/null) || { echo gone; exit 0; }',
    "case $p in ''|*[!0-9]*) echo gone; exit 0 ;; esac",
    "if kill -TERM -$p 2>/dev/null; then",
    "  i=0; while [ $i -lt 10 ] && kill -0 -$p 2>/dev/null; do sleep 1; i=$((i+1)); done",
    "  kill -KILL -$p 2>/dev/null",
    '  rm -f "$pf"; echo stopped; exit 0',
    "fi",
    "lists=; { command -v pgrep >/dev/null 2>&1 || [ -r /proc/self/status ]; } && lists=1",
    "kids() {",
    '  if command -v pgrep >/dev/null 2>&1; then pgrep -P "$1"',
    '  elif [ -n "$lists" ]; then for d in /proc/[0-9]*; do',
    `    [ "$(sed -n 's/^PPid:[[:space:]]*//p' "$d/status" 2>/dev/null)" = "$1" ] && echo "\${d#/proc/}"`,
    "  done; fi",
    "}",
    'tree() { for c in $(kids "$1"); do tree "$c"; done; echo "$1"; }',
    'all=$(tree "$p")',
    "alive() { for x in $all; do kill -0 $x 2>/dev/null && return 0; done; return 1; }",
    "kill -TERM $all 2>/dev/null",
    "i=0; while [ $i -lt 10 ] && alive; do sleep 1; i=$((i+1)); done",
    "kill -KILL $all 2>/dev/null",
    'rm -f "$pf"',
    `if [ -n "$lists" ]; then echo stopped; else echo ${PARTIAL_STOP}; fi`,
  ].join("\n");
}
