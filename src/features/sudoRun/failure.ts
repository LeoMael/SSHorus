// Textos de los fallos de sudo antes de ejecutar un comando (envoltorio del motor, `snippets.execSudo`).
// Pura: la usan «Ejecutar en varios servidores» y los comandos con sudo de un solo servidor.
import type { SudoWrapFailure } from "../../api/snippets";

/** Mensaje de un fallo de sudo antes de ejecutar el comando. */
export function sudoFailureText(f: SudoWrapFailure): string {
  switch (f) {
    case "bad-password":
      return "Contraseña de sudo incorrecta: sudo la rechazó y no se ejecutó el comando. Vuelve a intentarlo para escribir otra.";
    case "denied":
      return "Tu usuario no tiene permiso para usar sudo en este servidor: no se ejecutó el comando.";
    case "tty-required":
      return "sudo exige una terminal en este servidor (opción «requiretty»): no se puede usar desde aquí.";
    case "no-temp":
      return "No se pudo preparar sudo: no hay ninguna carpeta temporal donde se puedan ejecutar archivos.";
    case "no-sudo":
      return "sudo no está instalado en este servidor.";
  }
}

/** Qué salió mal en una ejecución con sudo (null si fue bien), para un aviso corto. */
export function sudoRunError(r: {
  sudoFailure: SudoWrapFailure | null;
  timedOut: boolean;
  exitCode: number | null;
  stderr: string;
}): string | null {
  if (r.sudoFailure) return sudoFailureText(r.sudoFailure);
  if (r.timedOut) return "No terminó a tiempo (puede que siga en el servidor).";
  if (r.exitCode === 0) return null;
  const last = r.stderr.trim().split("\n").pop()?.trim();
  return last || `Terminó con código ${r.exitCode ?? "desconocido"}.`;
}
