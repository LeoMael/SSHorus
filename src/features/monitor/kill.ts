// Terminar procesos desde el Monitor: comando `kill` y lectura de su salida.

/** `kill` (o `kill -9`) y, un segundo después, si sigue vivo. Salida: rc=…, alive=0|1. */
export function buildKillCommand(pid: number, force: boolean): string {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error("pid no válido");
  const sig = force ? "-9 " : "";
  // Un zombi (Z) ya terminó: solo espera a que su padre lo recoja.
  return `sh -c 'kill ${sig}${pid}; echo rc=$?; sleep 1; if [ -d /proc/${pid} ] || kill -0 ${pid} 2>/dev/null; then if grep -q ") Z " /proc/${pid}/stat 2>/dev/null; then echo alive=0; else echo alive=1; fi; else echo alive=0; fi'`;
}

export interface KillResult {
  ok: boolean;
  alive: boolean;
  permission: boolean;
  message: string;
}

export function parseKillOutput(stdout: string, stderr: string): KillResult {
  const rc = /rc=(\d+)/.exec(stdout);
  const alive = /alive=1/.test(stdout);
  const permission = /not permitted|permission|denied|no permitid|EPERM/i.test(stderr);
  return {
    ok: rc?.[1] === "0",
    alive,
    permission,
    message: stderr.trim().split("\n")[0] ?? "",
  };
}
