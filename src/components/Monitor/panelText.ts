// Textos de la cabecera del Monitor (funciones puras, sin React).

/** Hora local «hh:mm:ss». */
export function clock(t: number): string {
  const d = new Date(t);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Estado junto al intervalo: sin conexión, sin respuesta (hay datos viejos) o la hora de la última muestra. */
export function monitorStatus(disabled: boolean, error: string | null | undefined, at: number | null): string {
  if (disabled) return "Sin conexión";
  if (at === null) return "";
  return error ? "Sin respuesta" : `Actualizado ${clock(at)}`;
}

/** Texto al pasar por la campana: las alertas activas o si están encendidas. */
export function alertsTooltip(active: { title: string }[], enabled: boolean): string {
  if (active.length) return `Alertas activas:\n${active.map((a) => a.title).join("\n")}`;
  return enabled ? "Alertas activadas" : "Alertas desactivadas";
}

export function alertsAriaLabel(count: number): string {
  return count ? `Alertas: ${count} activa${count > 1 ? "s" : ""}` : "Configurar alertas";
}
