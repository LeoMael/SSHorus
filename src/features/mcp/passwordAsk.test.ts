// Pruebas de los diálogos de `run_with_password`: petición del motor, opciones, elegida por defecto y respuesta.
import { buildReply, initialChoice, parseAsk, passwordOptions } from "./passwordAsk";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const base = { serverName: "web", user: "deploy", command: "passwd", reason: "cambiar", timeoutSecs: 60 };

// ── Petición ──
const run = parseAsk("a", "run", { ...base, hasLogin: true, hasSudo: true, danger: ["x", 3] }, 1000);
eq(run.expiresAt, 61_000, "vence con timeoutSecs");
eq(run.danger, ["x"], "solo textos en danger");
eq(parseAsk("b", "run", {}, 0).serverName, "el servidor", "sin nombre");
eq(parseAsk("b", "run", {}, 0).expiresAt, 120_000, "tiempo por defecto");

// ── Por defecto: la guardada (primero la de la conexión) ──
eq(initialChoice(run).source, "login", "guardada de la conexión");
eq(initialChoice(parseAsk("c", "run", { ...base, hasSudo: true })).source, "sudo", "si solo hay de sudo");
eq(initialChoice(parseAsk("c", "run", base)).source, "typed", "sin guardadas, escribirla");
eq(initialChoice(run).sameForAll, true, "la misma para todas, por defecto");
const prompt = parseAsk("d", "prompt", { ...base, prompt: "Retype:", previous: ["Current:", "New:"], hasLogin: true });
eq([initialChoice(prompt).source, initialChoice(prompt).reuse], ["reuse", 1], "otra pregunta: la misma que la última");

// ── Opciones ──
eq(
  passwordOptions(prompt).map((o) => o.source),
  ["reuse", "reuse", "login", "typed"],
  "anteriores, guardadas y escribir",
);
eq(passwordOptions(parseAsk("e", "run", base)).map((o) => o.source), ["typed"], "sin guardadas");

// ── Respuesta ──
const choice = initialChoice(run);
eq(buildReply(run, choice), { source: "login", sameForAll: true }, "guardada");
eq(buildReply(run, { ...choice, sameForAll: false }), { source: "login", sameForAll: false }, "sin la misma para todas");
eq(buildReply(run, { ...choice, source: "typed", typed: "" }), null, "vacía no");
eq(buildReply(run, { ...choice, source: "typed", typed: "a\nb" }), null, "con salto de línea no");
eq(buildReply(run, { ...choice, source: "typed", typed: "clave ñ" }), { password: "clave ñ", sameForAll: true }, "escrita");
eq(buildReply(prompt, { ...initialChoice(prompt) }), { reuse: 1 }, "reusar");
eq(buildReply(prompt, { ...initialChoice(prompt), reuse: 5 }), null, "reusar una que no existe");
eq(buildReply(prompt, { ...initialChoice(prompt), source: "sudo" }), null, "guardada que no hay");
eq(buildReply(prompt, { ...initialChoice(prompt), source: "typed", typed: "x" }), { password: "x", sameForAll: false }, "en otra pregunta no hay «todas»");

console.log(`passwordAsk: ${passed} comprobaciones correctas`);
