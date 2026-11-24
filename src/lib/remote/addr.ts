// Direcciones «ip:puerto» tal como las muestran ss / netstat. Función pura, sin React ni Tauri.

/** Separa «dirección:puerto» en sus partes (IPv6 con o sin corchetes, «%interfaz», «*»). */
export function parseAddr(s: string): { ip: string; iface: string | null; port: number } | null {
  const i = s.lastIndexOf(":");
  if (i <= 0) return null;
  const portStr = s.slice(i + 1);
  if (!/^\d+$/.test(portStr)) return null;
  const port = Number(portStr);
  if (port < 1 || port > 65535) return null;
  let host = s.slice(0, i);
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  let iface: string | null = null;
  const pct = host.indexOf("%");
  if (pct >= 0) {
    iface = host.slice(pct + 1) || null;
    host = host.slice(0, pct);
  }
  return { ip: host || "*", iface, port };
}
