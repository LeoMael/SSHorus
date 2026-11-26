// Pruebas de las reglas puras del motor: errores de conexión, estado inicial y resultado del comando.
import type { ExecResult } from "../../api/types";
import { blankTarget, classifyConnectError, errText, execOutcome } from "./outcome";
import { Slots } from "./inflight";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) throw new Error(`${what}: ${a} ≠ ${b}`);
  passed++;
}

// Errores de conexión: los que se resuelven con un diálogo piden atención; el resto es error.
eq(classifyConnectError({ kind: "NeedsPassword", message: "x" }, "password").attention, "password", "sin contraseña");
eq(classifyConnectError({ kind: "HostKeyChanged" }, "key").attention, "hostkey-changed", "huella cambiada");
eq(classifyConnectError({ kind: "AuthFailed", message: "no" }, "password").attention, "auth", "contraseña rechazada");
eq(classifyConnectError({ kind: "AuthFailed", message: "no" }, "key"), { attention: null, message: "Autenticación fallida: no" }, "llave rechazada");
eq(classifyConnectError(new Error("sin red"), "password"), { attention: null, message: "sin red" }, "otro error");

eq(errText("texto"), "texto", "cadena");
eq(errText({ message: 42 }), "42", "objeto con mensaje");
eq(errText(null), "Error desconocido", "desconocido");

const t = blankTarget({ profileId: "a", name: "A", address: "a", auth: "password" });
eq([t.status, t.sessionId, t.result], ["queued", null, null], "en cola");

// Resultado del comando.
const ok: ExecResult = { stdout: "", stderr: "", exitCode: 0, durationMs: 1, truncated: false, timedOut: false };
eq(execOutcome(ok, 30), { status: "ok", detail: null }, "bien");
eq(execOutcome({ ...ok, exitCode: 2 }, 30), { status: "error", detail: null }, "código ≠ 0");
eq(execOutcome({ ...ok, exitCode: null }, 30), { status: "error", detail: "El comando terminó sin código de salida" }, "sin código");
eq(execOutcome({ ...ok, exitCode: null, timedOut: true }, 30), { status: "timeout", detail: "Sin terminar tras 30 s" }, "tiempo agotado");
eq(execOutcome({ ...ok, exitCode: 97, sudoFailure: "bad-password" }, 30).status, "error", "sudo rechazado");

// Turnos: con límite 1, el segundo espera a que el primero suelte.
{
  const slots = new Slots(() => 1);
  const order: string[] = [];
  await slots.acquire();
  const second = slots.acquire().then(() => order.push("segundo"));
  await Promise.resolve();
  order.push("primero suelta");
  slots.release();
  await second;
  eq(order, ["primero suelta", "segundo"], "turnos");
}

console.log(`multirun/outcome: ${passed} comprobaciones correctas`);
