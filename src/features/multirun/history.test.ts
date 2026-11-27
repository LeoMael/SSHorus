// Pruebas de «Ejecutar en varios servidores» en el historial: quién acaba de terminar y cómo queda.
import { finishedNow, multiRunEvent } from "./history";
import { blankTarget } from "./outcome";
import type { RunSpec, TargetState } from "./types";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) throw new Error(`${what}: ${a} ≠ ${b}`);
  passed++;
}

const t = (id: string, o: Partial<TargetState> = {}): TargetState => ({
  ...blankTarget({ profileId: id, name: id, address: `u@${id}`, auth: "password" }),
  ...o,
});
const spec: RunSpec = { command: "uptime\nfree -m", label: null, timeoutSecs: 30, concurrency: 4, usesSudo: false };

const prev = [t("a", { status: "running" }), t("b", { status: "ok", finishedAt: 5 })];
const next = [t("a", { status: "ok", finishedAt: 9 }), t("b", { status: "ok", finishedAt: 5 })];
eq(finishedNow(prev, next).map((x) => x.profileId), ["a"], "solo el que acaba de terminar");
eq(finishedNow(next, [t("a", { status: "ok", finishedAt: 12 }), next[1]]).map((x) => x.profileId), ["a"], "reintentar vuelve a contar");
eq(finishedNow([], [t("c", { status: "canceled" })]).length, 1, "cancelado también");
eq(finishedNow(next, next).length, 0, "sin cambios, nada");

const ev = multiRunEvent(spec, t("a", { status: "error", detail: "Código 1", result: { stdout: "x", stderr: "", exitCode: 1, durationMs: 1, truncated: false, timedOut: false } }));
eq([ev.source, ev.title, ev.ok, ev.serverName], ["multirun", "uptime …", false, "a"], "entrada");
eq(ev.result, "Falló\nCódigo 1\nCódigo de salida 1\nx", "resultado");
eq(multiRunEvent({ ...spec, label: "Memoria" }, t("a", { status: "ok" })).title, "Memoria", "con nombre de la Biblioteca");

console.log(`multirun/history: ${passed} pruebas correctas`);
