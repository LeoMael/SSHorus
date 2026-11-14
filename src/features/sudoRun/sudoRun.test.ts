// Pruebas de los textos de una ejecución con la contraseña de sudo de SSHorus.
// Ejecutar: npx rolldown src/features/sudoRun/sudoRun.test.ts -p node -f esm -o /tmp/sr.mjs && node /tmp/sr.mjs
import { sudoFailureText, sudoRunError } from "./failure";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const done = { sudoFailure: null, timedOut: false, exitCode: 0, stderr: "" };
eq(sudoRunError(done), null, "terminó bien");
eq(sudoRunError({ ...done, sudoFailure: "bad-password" }), sudoFailureText("bad-password"), "sudo rechazó la contraseña");
eq(sudoRunError({ ...done, sudoFailure: "denied", exitCode: 96 }), sudoFailureText("denied"), "sin permiso de sudo");
eq(sudoRunError({ ...done, timedOut: true, exitCode: null }), "No terminó a tiempo (puede que siga en el servidor).", "tiempo agotado");
eq(sudoRunError({ ...done, exitCode: 1, stderr: "Descargando…\nError: no hay paquete foo\n" }), "Error: no hay paquete foo", "última línea de stderr");
eq(sudoRunError({ ...done, exitCode: 100, stderr: "  " }), "Terminó con código 100.", "sin stderr: el código");

console.log(`sudoRun: ${passed} comprobaciones correctas`);
