// Pruebas del resumen incremental de un lote de transferencias.
import type { TransferJob } from "../api/types";
import { addJob, finishedToast, formatCount, newAgg, refreshFirstError, rootOf, summarize } from "./transferBatch";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) throw new Error(`${what}: ${a} ≠ ${b}`);
  passed++;
}

function job(id: string, name: string, p: Partial<TransferJob> = {}): TransferJob {
  return {
    id,
    batchId: "b1",
    sessionId: "s1",
    direction: "upload",
    localPath: `/l/${name}`,
    remotePath: `/r/${name}`,
    name,
    size: 100,
    transferred: 0,
    status: "queued",
    error: null,
    speed: 0,
    createdAt: 1,
    finishedAt: null,
    ...p,
  };
}

eq(formatCount(2000), "2.000", "miles");
eq(formatCount(1234567), "1.234.567", "millones");
eq(rootOf("fotos/a.png"), "fotos/", "raíz");
eq(rootOf("fotos\\a.png"), "fotos\\", "raíz de Windows");
eq(rootOf("informe.pdf"), "informe.pdf", "archivo suelto");

// Sumar, cambiar (restar el viejo y sumar el nuevo) y la etiqueta.
const a = newAgg(job("1", "fotos/a.png"));
const jobs: Record<string, TransferJob> = {};
for (const j of [job("1", "fotos/a.png"), job("2", "fotos/b.png"), job("3", "notas.txt")]) {
  a.jobIds.push(j.id);
  addJob(a, j, 1);
  jobs[j.id] = j;
}
let s = summarize(a, 0);
eq([s.status, s.total, s.queued, s.bytesTotal, s.label], ["queued", 3, 3, 300, "fotos/ y 1 más"], "en cola");

const running = job("1", "fotos/a.png", { status: "running", transferred: 40, speed: 10 });
addJob(a, jobs["1"], -1);
addJob(a, running, 1);
jobs["1"] = running;
s = summarize(a, 0);
eq([s.status, s.running, s.bytesDone, s.speed], ["running", 1, 40, 10], "en marcha (velocidad del trabajo al empezar)");

// Cancelados y omitidos no cuentan en los bytes.
const canceled = job("3", "notas.txt", { status: "canceled" });
addJob(a, jobs["3"], -1);
addJob(a, canceled, 1);
jobs["3"] = canceled;
eq(summarize(a, 0).bytesTotal, 200, "cancelado fuera de los bytes");

// Primer error y aviso al terminar.
for (const [id, st] of [["1", "done"], ["2", "error"]] as const) {
  const next = job(id, jobs[id].name, { status: st, transferred: 100, error: st === "error" ? "Sin permiso" : null });
  addJob(a, jobs[id], -1);
  addJob(a, next, 1);
  jobs[id] = next;
}
refreshFirstError(a, jobs);
s = summarize(a, 0);
eq([s.status, s.firstError, s.speed, s.eta], ["error", "Sin permiso", 0, null], "terminado con error");
eq(finishedToast(s), { kind: "error", title: "Subida con errores", body: "fotos/ y 1 más: fallaron 1 de 2 archivos" }, "aviso de error");
eq(
  finishedToast({ ...s, error: 0, skipped: 1, direction: "download" }),
  { kind: "success", title: "Descarga completada", body: "fotos/ y 1 más · 1 archivo · 1 omitido" },
  "aviso bien",
);
eq(finishedToast({ ...s, error: 0, done: 0, skipped: 0 }), null, "todo cancelado: sin aviso");

console.log(`transferBatch: ${passed} comprobaciones correctas`);
