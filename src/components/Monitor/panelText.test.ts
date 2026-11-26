// Pruebas de los textos de la cabecera del Monitor.
import { alertsAriaLabel, alertsTooltip, clock, monitorStatus } from "./panelText";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const t = new Date(2026, 0, 2, 3, 4, 5).getTime();
eq(clock(t), "03:04:05", "hora con ceros");

eq(monitorStatus(true, "falló", t), "Sin conexión", "sin conexión manda");
eq(monitorStatus(false, null, null), "", "aún sin datos");
eq(monitorStatus(false, "falló", null), "", "error sin datos: lo dice el cuerpo");
eq(monitorStatus(false, "falló", t), "Sin respuesta", "error con datos viejos");
eq(monitorStatus(false, null, t), "Actualizado 03:04:05", "al día");

eq(alertsTooltip([], true), "Alertas activadas", "encendidas sin activas");
eq(alertsTooltip([], false), "Alertas desactivadas", "apagadas");
eq(alertsTooltip([{ title: "CPU alta" }, { title: "Disco lleno" }], true), "Alertas activas:\nCPU alta\nDisco lleno", "lista de activas");

eq(alertsAriaLabel(0), "Configurar alertas", "sin activas");
eq(alertsAriaLabel(1), "Alertas: 1 activa", "una");
eq(alertsAriaLabel(3), "Alertas: 3 activas", "varias");

console.log(`panelText: ${passed} pruebas OK`);
