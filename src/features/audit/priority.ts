// Qué arreglar primero y, para lo que no tiene arreglo automático, qué hacer en una frase.
// Funciones puras: se prueban en fix.test.ts.
import type { Check } from "../../api/audit";
import { CATEGORIES } from "./score";

const CAT_WEIGHT = new Map(CATEGORIES.map((c) => [c.id, c.weight]));

/** Los problemas (mal y aviso), lo más importante primero: grave antes que aviso, luego por peso. */
export function problemsByImportance(checks: Check[]): Check[] {
  const rank = (c: Check) => (c.status === "bad" ? 2 : 1) * 10 + c.weight;
  return checks
    .filter((c) => c.status === "bad" || c.status === "warn")
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(b.c) - rank(a.c) || (CAT_WEIGHT.get(b.c.category) ?? 1) - (CAT_WEIGHT.get(a.c.category) ?? 1) || a.i - b.i)
    .map((x) => x.c);
}

/** Qué hacer cuando no hay un comando que lo arregle solo (o hay que decidirlo a mano). */
const ADVICE: Record<string, string> = {
  "users.nopasswd": "Quita «NOPASSWD:» de esas reglas con «visudo» (o deja solo los comandos que lo necesiten).",
  "users.empty": "Es la cuenta de otra persona: ponle una contraseña («passwd usuario») o bloquéala con el comando de abajo.",
  "users.uid0": "Si no la reconoces, bórrala; si la usas, dale otro UID. Revísalo a mano.",
  "net.ports": "Haz que ese servicio escuche solo en 127.0.0.1 o ciérralo en el cortafuegos.",
  "net.firewall": "Instala el cortafuegos con el comando de abajo y vuelve a auditar: entonces se podrá activar.",
  "updates.vulns": "Actualiza los paquetes y vuelve a analizar en «Vulnerabilidades».",
  "web.certs": "Renueva el certificado (p. ej. «certbot renew») y recarga el servidor web.",
  "ctr.privileged": "Vuelve a crear el contenedor sin --privileged (solo con los --cap-add que necesite).",
  "ctr.root": "Usa --user con un usuario sin privilegios, o Podman sin root.",
  "ctr.ports": "Publica el puerto en 127.0.0.1 y pon delante el proxy web.",
  "system.failed": "Mira por qué falló con el comando de abajo; arréglalo o desactívalo si no lo usas.",
  "system.disk": "Libera espacio: el comando de abajo dice qué ocupa más.",
  "system.mem": "Para lo que no uses o añade memoria o swap.",
  "logins.failed": "Instala fail2ban y entra solo con llave SSH.",
  "hard.webconf": "Caddy lee su configuración con su grupo: dáselo antes de quitar permisos.",
};

export function adviceFor(c: Check): string | null {
  return ADVICE[c.id] ?? c.fix?.note ?? null;
}
