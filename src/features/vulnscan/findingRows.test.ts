// Pruebas de los filtros y las filas de la tabla «Vulnerabilidades» (funciones puras).
import { buildVulnRows, filterFindings, hasActiveFilters, matchesVuln, NO_FILTERS } from "./findingRows";
import { finding, report } from "./fixtures";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const ssl = finding({ id: "CVE-2026-0101", package: "openssl", severity: "high", summary: "Desbordamiento en TLS" });
const curl = finding({ id: "CVE-2026-0102", package: "curl", severity: "low", hasFix: false, fixed: null });
const old = finding({ id: "CVE-2020-0001", package: "tar", severity: "medium", unimportant: true });
const k1 = finding({ id: "CVE-2026-0201", package: "linux", severity: "medium", kernel: true });
const k2 = finding({ id: "CVE-2026-0202", package: "linux", severity: "critical", kernel: true });
const img = finding({ id: "CVE-2026-0301", package: "zlib", target: "image:podman::abc", kernel: true });
const all = [ssl, curl, old, k1, k2, img];
const r = report("debian", "dpkg", all);
const ids = (l: { id: string }[]) => l.map((f) => f.id);

// ── Búsqueda: todas las palabras, sin distinguir mayúsculas ──
eq(matchesVuln(ssl, ""), true, "sin búsqueda entra todo");
eq(matchesVuln(ssl, "OPENSSL tls"), true, "dos palabras en campos distintos");
eq(matchesVuln(ssl, "openssl curl"), false, "falta una palabra");
eq(matchesVuln(curl, "0102"), true, "parte del id");

// ── Filtros ──
eq(ids(filterFindings(r, all, NO_FILTERS)), ids([ssl, curl, k1, k2, img]), "los «sin importancia» se ocultan por defecto");
eq(filterFindings(r, all, { ...NO_FILTERS, showUnimportant: true }).length, 6, "con la casilla se ven todos");
eq(ids(filterFindings(r, all, { ...NO_FILTERS, severity: "low" })), ["CVE-2026-0102"], "por gravedad");
eq(ids(filterFindings(r, all, { ...NO_FILTERS, origin: "image:podman::abc" })), ["CVE-2026-0301"], "por origen");
eq(filterFindings(r, all, { ...NO_FILTERS, onlyFix: true }).includes(curl), false, "solo con arreglo");
eq(ids(filterFindings(r, all, { ...NO_FILTERS, query: "  curl  " })), ["CVE-2026-0102"], "la búsqueda se recorta");
eq(filterFindings(null, all, { ...NO_FILTERS, fixFilter: "now" }).length, 0, "sin informe no hay tipo de arreglo");

eq(hasActiveFilters(NO_FILTERS), false, "sin filtros");
eq(hasActiveFilters({ ...NO_FILTERS, showUnimportant: true }), false, "«sin importancia» no es un filtro que quitar");
eq(hasActiveFilters({ ...NO_FILTERS, origin: "system" }), true, "con origen");

// ── Filas: el kernel del sistema en una fila plegable con la peor gravedad ──
const shown = filterFindings(r, all, NO_FILTERS);
const closed = buildVulnRows(shown, false);
eq(closed.map((x) => x.kind), ["kernel", "f", "f", "f"], "cerrada: una fila de kernel y el resto");
eq(closed[0].kind === "kernel" ? [closed[0].worst, closed[0].items.length] : null, ["critical", 2], "peor gravedad del kernel");
eq(closed.some((x) => x.kind === "f" && x.f === img), true, "el kernel de una imagen no se agrupa");
const open = buildVulnRows(shown, true);
eq(open.slice(1, 3).map((x) => (x.kind === "f" ? [x.f.id, x.child] : null)), [["CVE-2026-0201", true], ["CVE-2026-0202", true]], "abierta: hijos debajo");
eq(buildVulnRows([ssl], true).map((x) => x.kind), ["f"], "sin kernel no hay fila de kernel");

console.log(`findingRows: ${passed} comprobaciones correctas`);
