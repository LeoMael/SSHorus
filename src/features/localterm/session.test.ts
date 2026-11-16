// Pruebas de LocalSession (asistente abierto encima de la shell) con un motor falso.
// Ejecutar: npx rolldown src/features/localterm/session.test.ts -p node -f esm -o /tmp/ls.mjs && node /tmp/ls.mjs
import type { AiLaunch } from "../../api/localterm";
import { LocalSession, RESTORE_MODES, type LocalApi } from "./session";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

/** Motor falso: apunta cada llamada y deja emitir salida y salidas de proceso. */
function fakeApi() {
  const log: string[] = [];
  const data = new Map<string, (b: Uint8Array) => void>();
  const exits = new Map<string, (code: number | null) => void>();
  const opens: { cwd: string | null; cols: number; rows: number; launch: AiLaunch | null }[] = [];
  let seq = 0;
  const api: LocalApi = {
    open: async (opts, onData) => {
      const id = `ai${++seq}`;
      opens.push(opts);
      data.set(id, onData);
      return { termId: id, cwd: opts.cwd ?? "/home", program: "claude", mcp: !!opts.launch?.mcp, warning: null };
    },
    write: async (id, d) => void log.push(`write ${id} ${JSON.stringify(d)}`),
    resize: async (id, c, r) => void log.push(`resize ${id} ${c}x${r}`),
    close: async (id) => void log.push(`close ${id}`),
    state: async () => ({ cwd: "/home/ana/proyecto", busy: false }),
    onExit: (id, cb) => {
      exits.set(id, cb);
      return () => exits.delete(id);
    },
  };
  return { api, log, data, exits, opens };
}

const text = (chunks: Uint8Array[]) => chunks.map((c) => new TextDecoder().decode(c)).join("");
const launch: AiLaunch = { tool: "claude", context: "# Contexto", mcp: true };

async function main() {
  const f = fakeApi();
  let shellData: ((b: Uint8Array) => void) | null = null;
  const s = new LocalSession(f.api, async (_c, _r, onData) => {
    shellData = onData;
    return { termId: "sh" };
  });
  const shown: Uint8Array[] = [];
  const opened = await s.open(100, 30, (b) => shown.push(b));
  eq(opened.termId, "sh", "la vista ve el id de la shell");
  eq(s.isOpen(), true, "abierta");

  // Sin asistente: todo va a la shell.
  await s.write("sh", "ls\r");
  shellData!(new TextEncoder().encode("prompt$ "));
  eq(f.log.pop(), `write sh "ls\\r"`, "teclado a la shell");
  eq(text(shown), "prompt$ ", "salida de la shell visible");

  // Asistente encima, en la carpeta pedida y con el tamaño actual.
  let ended: number | null | undefined;
  const r = await s.runOnTop(launch, "/home/ana/proyecto", (code) => (ended = code));
  eq(r?.termId, "ai1", "abre el asistente");
  eq(f.opens[0], { cwd: "/home/ana/proyecto", cols: 100, rows: 30, launch }, "carpeta, tamaño y lanzamiento");
  eq(s.hasTop(), true, "hay asistente encima");
  let failed = false;
  await s.runOnTop(launch, null, () => {}).catch(() => (failed = true));
  eq(failed, true, "no se abre un segundo asistente encima");

  await s.write("sh", "hola\r");
  eq(f.log.pop(), `write ai1 "hola\\r"`, "teclado al asistente");
  shown.length = 0;
  shellData!(new TextEncoder().encode("ruido de la shell"));
  f.data.get("ai1")!(new TextEncoder().encode("⏺ Hola"));
  eq(text(shown), "⏺ Hola", "solo se ve la salida del asistente");

  await s.resize("sh", 120, 40);
  eq(f.log.slice(-2), ["resize sh 120x40", "resize ai1 120x40"], "se redimensionan los dos");

  // Al salir el asistente: modos restaurados, aviso y prompt nuevo en la shell.
  shown.length = 0;
  f.exits.get("ai1")!(0);
  eq(ended, 0, "avisa del final");
  eq(s.hasTop(), false, "ya no hay asistente");
  eq(text(shown), RESTORE_MODES, "restaura los modos de la terminal");
  await Promise.resolve();
  eq(f.log.slice(-2), ["resize sh 120x40", `write sh "\\r"`], "la shell vuelve a dibujar su prompt");
  await s.write("sh", "pwd\r");
  eq(f.log.pop(), `write sh "pwd\\r"`, "el teclado vuelve a la shell");

  // Cerrar la pestaña con un asistente encima: terminan los dos.
  await s.runOnTop(launch, null, () => {});
  await s.close("sh");
  eq(f.log.slice(-2), ["close ai2", "close sh"], "cerrar termina el asistente y la shell");
  eq(s.isOpen(), false, "cerrada");

  // Lo tecleado mientras arranca se envía al asistente cuando está listo.
  const g = fakeApi();
  let release!: () => void;
  const slowApi: LocalApi = {
    ...g.api,
    open: (opts, onData) => new Promise((res) => (release = () => res(g.api.open(opts, onData)))),
  };
  const s2 = new LocalSession(slowApi, async () => ({ termId: "sh" }));
  await s2.open(80, 24, () => {});
  const p = s2.runOnTop(launch, null, () => {});
  await s2.write("sh", "pronto");
  eq(g.log.length, 0, "nada a la shell mientras arranca");
  release();
  await p;
  eq(g.log.pop(), `write ai1 "pronto"`, "lo tecleado llega al asistente");

  console.log(`session: ${passed} comprobaciones correctas`);
}

// Un fallo deja la promesa rechazada: node termina con error.
void main();
