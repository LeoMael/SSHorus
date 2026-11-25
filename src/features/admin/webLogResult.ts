// Lectura de lo que escribe el script de webTrafficSetup.ts: avisos de paso («@@paso …») en vivo y,
// al terminar, un mensaje claro en español con la línea que falló (nginx -t, caddy validate, SELinux).
// Funciones puras.
import type { WebServer } from "./webTypes";
import { LOG_BACKUP_DIR, type LogStepKey, type SiteLogPlan } from "./webTrafficSetup";

const MARK = /^@@(paso|fallo|estado|verifica|selinux)\b ?(.*)$/;

/** Separa la salida en vivo: los avisos de paso van a `onStep` y el resto a `onText` (sin marcas). */
export class LogStepStream {
  private rest = "";
  constructor(
    private readonly onStep: (key: LogStepKey) => void,
    private readonly onText: (text: string) => void,
  ) {}

  push(chunk: string): void {
    const lines = (this.rest + chunk).split("\n");
    this.rest = lines.pop() ?? "";
    for (const l of lines) this.line(l);
  }

  end(): void {
    if (this.rest) this.line(this.rest);
    this.rest = "";
  }

  private line(l: string) {
    const m = MARK.exec(l.replace(/\r$/, ""));
    if (!m) this.onText(`${l}\n`);
    else if (m[1] === "paso") this.onStep(m[2].trim() as LogStepKey);
    else if (m[1] === "selinux") this.onText(`${m[2]}\n`);
  }
}

type FailCode = "python" | "tmp" | "before" | "patch" | "backup" | "folder" | "selinux" | "edit" | "validate" | "reload";

const TOOL: Record<WebServer, { name: string; check: string }> = {
  caddy: { name: "Caddy", check: "caddy validate" },
  nginx: { name: "nginx", check: "nginx -t" },
};

const NOTHING = "No se cambió nada.";
const RESTORED = "Se dejó el archivo como estaba y el servidor sigue con la configuración anterior.";

const FAIL_TEXT: Record<FailCode, (s: WebServer) => string> = {
  python: () => `Hace falta python3 en el servidor para editar la configuración sin riesgo (instálalo con «dnf install python3» o «apt install python3»). ${NOTHING}`,
  tmp: () => `No se pudo crear una carpeta temporal en el servidor. ${NOTHING}`,
  before: (s) => `La configuración ya tenía un error antes del cambio (${TOOL[s].check} falla): arréglalo primero. ${NOTHING}`,
  patch: () => `No se pudo preparar el cambio. ${NOTHING}`,
  backup: () => `No se pudo guardar la copia de respaldo en ${LOG_BACKUP_DIR}. ${NOTHING}`,
  folder: () => `No se pudo preparar la carpeta o el archivo del registro (dueño y permisos). ${NOTHING}`,
  selinux: () => `No se pudo dar a la carpeta del registro el contexto SELinux httpd_log_t (hace falta semanage o chcon). ${NOTHING}`,
  edit: () => `No se pudo escribir el archivo de configuración. ${RESTORED}`,
  validate: (s) => `La configuración nueva no pasó «${TOOL[s].check}». ${RESTORED}`,
  reload: (s) => `${TOOL[s].name} no aceptó la recarga. ${RESTORED}`,
};

/** Pistas según lo que dice la salida (la primera que encaje). */
const HINTS: { test: (out: string) => boolean; text: string }[] = [
  {
    test: (o) => /avc:\s+denied/.test(o),
    text: "SELinux lo bloqueó (líneas «avc: denied»): el registro tiene que estar en una carpeta con contexto httpd_log_t.",
  },
  {
    test: (o) => /permission denied|\(13:/i.test(o),
    text: "Permiso denegado: el servidor web no puede abrir el archivo del registro. Revisa el dueño de la carpeta y del archivo (y SELinux, si está activo).",
  },
  { test: (o) => /is not active, cannot reload/.test(o), text: "El servicio no está en marcha: arráncalo y vuelve a intentarlo." },
  { test: (o) => /connection refused|dial tcp/i.test(o), text: "No responde la API de administración de Caddy (localhost:2019)." },
];

/** El mensaje de error de una línea JSON de Caddy, o la línea tal cual. */
function plainLine(l: string): string {
  const t = l.trim();
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      const msg = [o.msg, o.error].filter((x): x is string => typeof x === "string" && !!x).join(": ");
      if (msg) return msg;
    } catch {
      /* no era JSON */
    }
  }
  return t;
}

/** La línea que explica el fallo (la de nginx [emerg], el «Error:» o el error JSON de Caddy, SELinux…). */
export function failingLine(out: string): string | null {
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const pats = [/\[(emerg|crit|alert)\]/, /"level":"error"/, /^Error:/, /avc:\s+denied/, /permission denied/i];
  for (const p of pats) {
    const hit = lines.find((l) => p.test(l));
    if (hit) return plainLine(hit).slice(0, 400);
  }
  return null;
}

export interface LogRunOutcome {
  ok: boolean;
  /** Mensaje para la tarea si falló. */
  error: string | null;
  /** Resumen si salió bien (o con aviso si la visita de prueba no apareció). */
  summary: string | null;
}

interface RunOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut?: boolean;
}

function successText(plan: SiteLogPlan, out: string): string {
  const state = /^@@estado (\S+)/m.exec(out)?.[1];
  if (plan.action === "disable") {
    return state === "absent"
      ? "Este sitio no tenía un registro puesto por SSHorus: no se cambió nada."
      : `Registro quitado. El archivo ${plan.logPath} se conserva (puedes borrarlo si ya no lo quieres).`;
  }
  const again = state === "already" ? " (ya estaba en la configuración: se revisaron permisos y se recargó)" : "";
  switch (/^@@verifica (\S+)/m.exec(out)?.[1]) {
    case "ok":
      return `Registro activado en ${plan.logPath}${again}: la visita de prueba ya aparece.`;
    case "sin-cliente":
      return `Registro activado en ${plan.logPath}${again}. No se pudo hacer una visita de prueba (falta curl o wget).`;
    default:
      return `Registro activado en ${plan.logPath}${again}, pero la visita de prueba no apareció. ${
        HINTS.find((h) => h.test(out))?.text ??
        "Puede que el sitio no responda en 127.0.0.1 con su dominio; abre la web y vuelve a mirar el tráfico."
      }`;
  }
}

/** Interpreta el resultado del script de `plan`. */
export function readLogRun(plan: SiteLogPlan, server: WebServer, r: RunOutput): LogRunOutcome {
  const out = `${r.stdout}\n${r.stderr}`;
  if (r.exitCode === 0 && !r.timedOut) return { ok: true, error: null, summary: successText(plan, out) };
  const code = /^@@fallo (\S+)/m.exec(r.stdout)?.[1] as FailCode | undefined;
  const base = r.timedOut
    ? `El servidor tardó demasiado en responder. ${RESTORED}`
    : code && FAIL_TEXT[code]
      ? FAIL_TEXT[code](server)
      : `El cambio no terminó (código ${r.exitCode ?? "?"}). ${RESTORED}`;
  // El parche explica en español por qué no pudo (no encuentra el bloque, JSON…): esa es la línea.
  const line = code === "patch" ? (r.stderr.trim().split("\n").pop() ?? null) : failingLine(out);
  const hint = HINTS.find((h) => h.test(out))?.text;
  const error = [base, line && `${code === "patch" ? "Motivo" : "Línea que falló"}: ${line}`, hint].filter(Boolean).join("\n");
  return { ok: false, error, summary: null };
}
