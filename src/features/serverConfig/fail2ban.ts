// fail2ban: cárceles activas, intentos fallidos y direcciones bloqueadas (con «Desbloquear»). Instalarlo
// o arrancarlo es el arreglo de la Auditoría («logins.fail2ban»). Funciones puras.
import { shQuote } from "../../lib/remote";
import { change, row, type ConfigChange, type ConfigRow } from "./model";

export interface Jail {
  name: string;
  failedNow: number | null;
  failedTotal: number | null;
  bannedNow: number | null;
  bannedTotal: number | null;
  banned: string[];
  /** De dónde lee (archivo o journal). */
  source: string | null;
}

export interface Fail2banState {
  installed: boolean;
  /** Sin sudo no se puede preguntar a fail2ban-client. */
  noread: boolean;
  /** El cliente respondió (el servicio está en marcha). */
  running: boolean;
  jails: Jail[];
}

const num = (s: string | undefined) => (s && /^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

export function parseFail2ban(ls: string[]): Fail2banState {
  const st: Fail2banState = { installed: true, noread: false, running: false, jails: [] };
  let cur: Jail | null = null;
  for (const l of ls) {
    if (l === "@none") st.installed = false;
    else if (l === "@noread") st.noread = true;
    else if (l.startsWith("@jail ")) {
      cur = { name: l.slice(6).trim(), failedNow: null, failedTotal: null, bannedNow: null, bannedTotal: null, banned: [], source: null };
      st.jails.push(cur);
    } else {
      const m = /^[\s|`-]*([A-Za-z ]+):\s*(.*)$/.exec(l);
      if (!m) continue;
      const k = m[1].trim().toLowerCase();
      const v = m[2].trim();
      if (k === "jail list" || k === "number of jail") st.running = true;
      if (!cur) continue;
      if (k === "currently failed") cur.failedNow = num(v);
      else if (k === "total failed") cur.failedTotal = num(v);
      else if (k === "currently banned") cur.bannedNow = num(v);
      else if (k === "total banned") cur.bannedTotal = num(v);
      else if (k === "banned ip list") cur.banned = v.split(/\s+/).filter(Boolean);
      else if (k === "file list" || k === "journal matches") cur.source = v || null;
    }
  }
  return st;
}

const JAIL_RE = /^[A-Za-z0-9_.-]{1,64}$/;
/** IPv4, IPv6 o red con máscara: solo esos caracteres (lo demás no se ofrece desbloquear). */
const IP_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9A-Fa-f:]{2,39})(?:\/\d{1,3})?$/;

export function unbanChange(jail: string, ip: string): ConfigChange | null {
  if (!JAIL_RE.test(jail) || !IP_RE.test(ip)) return null;
  return change({
    id: `f2b:unban:${jail}:${ip}`,
    label: "Desbloquear",
    title: `fail2ban: desbloquear ${ip}`,
    explain: `${ip} vuelve a poder conectarse (cárcel «${jail}»). Si sigue fallando, se bloqueará otra vez.`,
    steps: [`fail2ban-client set ${shQuote(jail)} unbanip ${shQuote(ip)}`],
  });
}

/** Una fila por cárcel y una por dirección bloqueada (las primeras 30 de cada cárcel). */
export function jailRows(st: Fail2banState, myIp: string | null): ConfigRow[] {
  const out: ConfigRow[] = [];
  for (const j of st.jails) {
    out.push(
      row({
        id: `jail:${j.name}`,
        title: `Cárcel «${j.name}»`,
        detail: [
          `${j.bannedNow ?? "?"} bloqueadas ahora (${j.bannedTotal ?? "?"} en total)`,
          `${j.failedNow ?? "?"} intentos fallidos ahora (${j.failedTotal ?? "?"} en total)`,
          j.source ? `lee ${j.source}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        status: "info",
      }),
    );
    for (const ip of j.banned.slice(0, 30)) {
      const mine = ip === myIp;
      out.push(
        row({
          id: `ban:${j.name}:${ip}`,
          title: ip,
          detail: mine ? "Es la dirección desde la que te conectas ahora" : `Bloqueada por «${j.name}»`,
          status: mine ? "bad" : "info",
          change: unbanChange(j.name, ip),
        }),
      );
    }
    if (j.banned.length > 30) out.push(row({ id: `ban:${j.name}:more`, title: `… y ${j.banned.length - 30} más`, detail: "", status: "info" }));
  }
  return out;
}
