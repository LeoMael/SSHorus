// Pruebas de «Sincronizar carpeta» (lo puro): patrones, nombres, estado y resumen de la comparación.
import { agoText, findActive, lastText, localName, parseIgnore, previewLines, specOf, startLabel, statusText, syncLabel } from "./model";
import type { SyncInfo, SyncPreview } from "../../api/folderSync";

declare const process: { exit(code: number): never };

let failed = 0;
let passed = 0;
function ok(cond: unknown, msg: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`✗ ${msg}`);
  }
}
function eq<T>(a: T, b: T, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}

const spec = { localDir: "C:\\Users\\ana\\web\\", remoteDir: "/var/www/html", ignore: [], deleteRemote: false };
const info: SyncInfo = {
  id: "1",
  sessionId: "s1",
  spec,
  state: "idle",
  pending: 0,
  files: 10,
  lastFile: "css/estilo.css",
  lastAt: 1_000_000,
  error: null,
  warning: null,
  remembered: false,
};

// Patrones y nombres
eq(parseIgnore("*.log\r\n\n  # comentario\n dist/ \n"), ["*.log", "dist/"], "patrones del cuadro");
eq(localName("C:\\Users\\ana\\web\\"), "web", "nombre de carpeta de Windows");
eq(localName("/home/ana/web"), "web", "nombre de carpeta de Linux");
eq(syncLabel(spec), "web → /var/www/html", "etiqueta");
eq(specOf({ ...spec, serverId: "x" }), spec, "guardada → sin el servidor");

// Estado
eq(statusText(info), "Al día", "al día");
eq(statusText({ ...info, state: "uploading", pending: 3 }), "Subiendo 3", "subiendo");
eq(statusText({ ...info, state: "paused" }), "En pausa", "pausa");
eq(statusText({ ...info, state: "error", error: "a.txt: sin permiso" }), "Error: a.txt: sin permiso", "error");
eq(statusText({ ...info, state: "waiting", pending: 1 }), "Esperando la conexión (1 cambio)", "esperando con cambios");
eq(agoText(0, 4_000), "hace 4 s", "segundos");
eq(agoText(0, 180_000), "hace 3 min", "minutos");
eq(agoText(0, 7_200_000), "hace 2 h", "horas");
eq(lastText(info, 1_005_000), "Último: estilo.css · hace 5 s", "último subido");
eq(lastText({ ...info, lastFile: null }, 0), null, "sin subidas aún");

// Comparación inicial
const item = (rel: string, size = 1) => ({ rel, size, localMtime: 1, remoteMtime: null });
const p: SyncPreview = { localFiles: 4, toUpload: [item("a", 2048), item("b", 0)], uploadBytes: 2048, remoteNewer: [item("c")], same: 1, truncated: false };
eq(
  previewLines(p),
  [
    "2 archivos faltan o son más nuevos en tu PC (2.0 KB)",
    "1 archivo ya está igual en los dos sitios",
    "1 archivo es más nuevo en el servidor: no se tocan salvo que lo marques",
  ],
  "resumen",
);
eq(previewLines({ ...p, toUpload: [], same: 0, remoteNewer: [] }), ["No hace falta subir nada: el servidor ya tiene lo de tu PC"], "nada que subir");
eq(startLabel(p, false), "Unir y subir 2", "botón sin pisar");
eq(startLabel(p, true), "Unir y subir 3", "botón pisando");
eq(startLabel({ ...p, toUpload: [] }, false), "Unir carpetas", "botón sin subidas");

// Duplicados
ok(findActive([info], "s1", "/var/www/html/"), "misma carpeta con / final");
ok(!findActive([info], "s2", "/var/www/html"), "otra conexión");

console.log(`${passed} pruebas bien, ${failed} mal`);
if (failed) process.exit(1);
