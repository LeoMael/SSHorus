// AppArmor (Debian, Ubuntu, openSUSE): si está activo, sus perfiles por modo y las denegaciones
// recientes («apparmor="DENIED"») explicadas. Solo lectura: los perfiles se ajustan a mano. Funciones puras.
import { shQuote } from "../../lib/remote";
import { row, type ConfigRow } from "./model";

export interface AppArmorState {
  /** El módulo existe en el kernel. */
  present: boolean;
  enabled: boolean;
  /** Perfiles por modo (enforce, complain, kill, unconfined…). */
  modes: Record<string, number>;
  /** Perfiles en modo de aviso (complain). */
  complain: string[];
  /** No se pudieron leer los perfiles (sin sudo). */
  noread: boolean;
}

export function parseAppArmor(ls: string[]): AppArmorState {
  const st: AppArmorState = { present: false, enabled: false, modes: {}, complain: [], noread: false };
  for (const l of ls) {
    if (l.startsWith("enabled ")) {
      st.present = true;
      st.enabled = l.slice(8).trim() === "Y";
    } else if (l === "@noread") st.noread = true;
    else if (l.startsWith("p ")) {
      const m = /^p (.+) \(([a-z_]+)\)$/.exec(l);
      if (!m) continue;
      st.modes[m[2]] = (st.modes[m[2]] ?? 0) + 1;
      if (m[2] === "complain") st.complain.push(m[1]);
    }
  }
  return st;
}

export interface AaDenial {
  time: number | null;
  profile: string;
  operation: string;
  name: string | null;
  comm: string;
  mask: string;
}

export function parseAaLine(l: string): AaDenial | null {
  if (!l.includes('apparmor="DENIED"')) return null;
  const f: Record<string, string> = {};
  for (const kv of l.matchAll(/([a-z_]+)=("([^"]*)"|\S+)/g)) f[kv[1]] = kv[3] ?? kv[2];
  const t = /audit\((\d+)(?:\.\d+)?:\d+\)/.exec(l)?.[1] ?? /^(\d{9,})(?:\.\d+)?\s/.exec(l)?.[1];
  if (!f.profile) return null;
  return { time: t ? Number(t) : null, profile: f.profile, operation: f.operation ?? "?", name: f.name ?? null, comm: f.comm ?? "?", mask: f.denied_mask ?? f.requested_mask ?? "" };
}

const OPS: Record<string, string> = {
  open: "abrir",
  exec: "ejecutar",
  mknod: "crear",
  unlink: "borrar",
  rename_src: "renombrar",
  file_perm: "usar",
  connect: "conectarse a",
  create: "crear",
  capable: "usar un permiso de sistema",
  ptrace: "inspeccionar otro proceso",
  signal: "mandar una señal",
};

const MASK: Record<string, string> = { r: "leer", w: "escribir", x: "ejecutar", c: "crear", d: "borrar", a: "añadir a", k: "bloquear", m: "cargar en memoria" };

function what(d: AaDenial): string {
  const verb = d.mask && /^[rwxcdakm]+$/.test(d.mask) ? [...d.mask].map((c) => MASK[c]).join(" y ") : (OPS[d.operation] ?? d.operation);
  return d.name ? `${verb} «${d.name}»` : verb;
}

/** Junta las repetidas y da una fila por grupo, con qué hacer. */
export function aaRows(ls: string[]): ConfigRow[] {
  const by = new Map<string, { d: AaDenial; n: number; last: number | null }>();
  for (const l of ls) {
    const d = parseAaLine(l);
    if (!d) continue;
    const key = `${d.profile}|${d.operation}|${d.mask}|${d.name ?? ""}`;
    const g = by.get(key);
    if (g) {
      g.n++;
      if (d.time !== null && (g.last === null || d.time > g.last)) g.last = d.time;
    } else by.set(key, { d, n: 1, last: d.time });
  }
  return [...by.entries()]
    .sort((a, b) => (b[1].last ?? 0) - (a[1].last ?? 0))
    .slice(0, 50)
    .map(([key, { d, n }]) => {
      const container = /^(docker-default|containers-default|crun|podman)/.test(d.profile);
      return row({
        id: key,
        title: `${d.comm}: ${what(d)}`,
        detail: `El perfil «${d.profile}» no dejó a ${d.comm} ${what(d)}${n > 1 ? ` (${n} veces)` : ""}.`,
        status: "warn",
        advice: container
          ? "Es el perfil de los contenedores: si el contenedor de verdad lo necesita, ajusta sus opciones (--security-opt) en vez de quitar el perfil."
          : `Si es algo legítimo, añade la regla en /etc/apparmor.d/local/ y recarga el perfil; para probar, ponlo en modo de aviso.`,
        copy: container ? null : `aa-complain ${shQuote(d.profile)}`,
      });
    });
}
