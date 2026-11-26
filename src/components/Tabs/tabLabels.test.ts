// Pruebas de los textos de las pestañas de la barra (funciones puras).
import { localTooltip, tabClass, tabTooltip } from "./tabLabels";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const base = { title: "web-1", status: "connected" as const, closedReason: null, reconnect: null };
eq(tabTooltip(base), "web-1", "conectada: solo el nombre");
eq(tabTooltip({ ...base, status: "closed" }), "web-1 — conexión perdida", "cerrada sin motivo");
eq(tabTooltip({ ...base, status: "closed", closedReason: "tiempo agotado" }), "web-1 — conexión perdida: tiempo agotado", "cerrada con motivo");
eq(tabTooltip({ ...base, status: "reconnecting" }), "web-1 — reconectando", "reconectando sin datos");
const reconnect = { sessionId: "s", attempt: 2, maxAttempts: 5, nextRetrySecs: 3, reason: "red caída", waitingUnlock: false };
eq(tabTooltip({ ...base, status: "reconnecting", reconnect }), "web-1 — reconectando (intento 2 de 5): red caída", "reconectando con intento");

eq(localTooltip({ kind: "shell", title: "Terminal", cwd: null, status: "running" }), "Terminal de este equipo", "shell local");
eq(localTooltip({ kind: "shell", title: "Terminal", cwd: "/home/ana", status: "exited" }), "Terminal de este equipo — /home/ana — terminado", "shell terminada con carpeta");
eq(localTooltip({ kind: "claude", title: "Claude Code", cwd: null, status: "running" }), "Claude Code (en este equipo)", "asistente");

eq(tabClass("tabs-tab", false, "active", null, undefined, "closed"), "tabs-tab active closed", "clases sin las falsas");

console.log(`${passed} comprobaciones`);
