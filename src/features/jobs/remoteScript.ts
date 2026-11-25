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

/** Detiene la tarea (como su dueño): TERM a todo el grupo, espera hasta 10 s y luego KILL. */
export function killJobScript(jobId: string): string {
  return [
    `pf=${pidFile(jobId)}`,
    'p=$(cat "$pf" 2>/dev/null) || { echo gone; exit 0; }',
    "case $p in ''|*[!0-9]*) echo gone; exit 0 ;; esac",
    "kill -TERM -$p 2>/dev/null || kill -TERM $p 2>/dev/null",
    "i=0; while [ $i -lt 10 ] && kill -0 -$p 2>/dev/null; do sleep 1; i=$((i+1)); done",
    "kill -KILL -$p 2>/dev/null",
    'rm -f "$pf"',
    "echo stopped",
  ].join("\n");
}
