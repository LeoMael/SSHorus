// Discos del Monitor: lectura de `df -kP` sin los sistemas de archivos que no son discos de verdad.
import type { DiskUsage } from "./sample";

const PSEUDO_FS = new Set(["tmpfs", "devtmpfs", "shm", "udev", "none", "proc", "sysfs", "cgroup", "cgroup2", "efivarfs", "run", "devfs", "squashfs"]);
const PSEUDO_MOUNT = /^\/(proc|sys|dev|run|snap)(\/|$)/;

/**
 * `df -kP`. Deja fuera lo que no es disco de verdad: tmpfs/devtmpfs/shm, montajes de /proc, /sys, /dev, /run,
 * los squashfs de snap y `overlay` (salvo si es la raíz: en un contenedor es el único disco que hay).
 * Si el mismo sistema de archivos está montado varias veces (bind mounts), queda el montaje más corto.
 */
export function parseDf(lines: string[]): DiskUsage[] {
  const all: DiskUsage[] = [];
  for (const l of lines) {
    if (/^Filesystem\s/i.test(l) || /^S\.\s*ficheros/i.test(l)) continue;
    // El punto de montaje puede tener espacios: los 4 números + "NN%" marcan dónde empieza.
    const m = /^(.*?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(\/.*)$/.exec(l);
    if (!m) continue;
    const [, fs, size, used, avail, pct, mount] = m;
    all.push({ fs, mount, sizeKb: Number(size), usedKb: Number(used), availKb: Number(avail), pct: Number(pct) });
  }
  const keep = all.filter((d) => {
    if (d.sizeKb <= 0) return false;
    if (PSEUDO_FS.has(d.fs)) return false;
    if (d.fs === "overlay" && d.mount !== "/") return false;
    if (/^\/dev\/loop/.test(d.fs) && d.mount.startsWith("/snap")) return false;
    if (PSEUDO_MOUNT.test(d.mount)) return false;
    return true;
  });
  // Mismos números → el mismo sistema de archivos montado varias veces (bind mounts, raíz de un contenedor).
  const byKey = new Map<string, DiskUsage>();
  for (const d of keep) {
    const key = `${d.sizeKb}|${d.usedKb}`;
    const prev = byKey.get(key);
    if (!prev || d.mount.length < prev.mount.length) byKey.set(key, d);
  }
  return [...byKey.values()].sort((a, b) => (a.mount === "/" ? -1 : b.mount === "/" ? 1 : a.mount.localeCompare(b.mount)));
}
