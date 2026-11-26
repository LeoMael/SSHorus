// Pruebas de los textos de «Actualizar imagen» (funciones puras).
import type { ExecResult } from "../../api/types";
import { outputTail, runAsText } from "./imageUpdateText";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

eq(runAsText({ kind: "self" }, "ana"), "Se ejecutará con tu usuario:", "con mi usuario");
eq(runAsText({ kind: "root" }, "root"), "Se ejecutará como root:", "como root");
eq(runAsText({ kind: "user", name: "web" }, "web").startsWith("Se ejecutará como «web»"), true, "como el dueño");

const r = (stdout: string, stderr = ""): ExecResult => ({ stdout, stderr, exitCode: 1, durationMs: 1, truncated: false, timedOut: false });
eq(outputTail(null), "", "sin resultado");
eq(outputTail(r("a\nb\nc\n", "  error  \n"), 2), "c\nerror", "las últimas líneas, stderr al final y sin espacios sobrantes");
eq(outputTail(r("", "solo stderr")), "solo stderr", "sin stdout no deja una línea vacía");
eq(outputTail(r(Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n"))).split("\n").length, 40, "40 líneas por defecto");

console.log(`imageUpdateText: ${passed} comprobaciones correctas`);
