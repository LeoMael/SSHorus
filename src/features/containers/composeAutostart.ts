// Arranque solo de un proyecto de podman-compose (Podman sin root). podman-compose marca sus contenedores
// con la unidad «podman-compose@<proyecto>.service», pero esa unidad solo existe si:
//   1. está la plantilla podman-compose@.service (`podman-compose systemd -a create-unit`),
//   2. el proyecto está registrado (`podman-compose systemd -a register` → ~/.config/containers/compose/projects/<p>.env),
//   3. y se habilita (`systemctl --user enable --now podman-compose@<p>.service`), con linger para el usuario.
// Si no hay podman-compose (solo el plugin docker-compose), la otra forma es la política de reinicio +
// podman-restart.service. Aquí: qué se lee del servidor, la decisión y los comandos. Funciones puras.
import { q } from "./shell";
import type { Cmd } from "./shell";

export const PC_TEMPLATE = "podman-compose@.service";
/** Carpeta (en el HOME del dueño) donde `register` deja el `.env` de cada proyecto. */
export const PC_PROJECTS_DIR = ".config/containers/compose/projects";
const USER_UNITS_DIR = ".config/systemd/user";

/** «podman-compose@seguimiento_siu.service» → «seguimiento_siu» (null si es otra unidad). */
export function composeUnitProject(unit: string | null): string | null {
  const m = /^podman-compose@(.+)\.service$/.exec(unit ?? "");
  return m ? m[1] : null;
}

export const composeUnitName = (project: string) => `podman-compose@${project}.service`;

/**
 * Líneas para el script de lectura del arranque (como el dueño; usan `$units`, las unidades de sus
 * contenedores). Todo por archivos: funciona aunque su gestor de systemd no esté en marcha.
 */
export function composeFactsLines(): string[] {
  const plugins = ["$HOME/.docker/cli-plugins", "/usr/local/lib/docker/cli-plugins", "/usr/local/libexec/docker/cli-plugins", "/usr/lib/docker/cli-plugins", "/usr/libexec/docker/cli-plugins"];
  return [
    "echo @@tv:pcompose",
    'echo "bin=$(command -v podman-compose 2>/dev/null)"',
    "dc=no; if command -v docker-compose >/dev/null 2>&1; then dc=yes; fi",
    `for d in ${plugins.map((p) => `"${p}"`).join(" ")}; do if [ -x "$d/docker-compose" ]; then dc=yes; fi; done`,
    'echo "dcompose=$dc"',
    `for d in "$HOME/${USER_UNITS_DIR}" /etc/systemd/user /usr/local/lib/systemd/user /usr/lib/systemd/user; do`,
    `  if [ -e "$d/${PC_TEMPLATE}" ]; then echo "template=$d/${PC_TEMPLATE}"; fi`,
    "done",
    "for u in $units; do",
    '  case "$u" in',
    "    podman-compose@*.service)",
    "      p=${u#podman-compose@}; p=${p%.service}",
    `      if [ -e "$HOME/${PC_PROJECTS_DIR}/$p.env" ]; then echo "registered=$p"; fi`,
    `      if [ -e "$HOME/${USER_UNITS_DIR}/default.target.wants/$u" ]; then echo "enabled=$p"; fi ;;`,
    "  esac",
    "done",
  ];
}

export interface ComposeFacts {
  /** Ruta de podman-compose para el dueño (null = no está instalado). */
  bin: string | null;
  /** Está el plugin docker-compose (lo que usa «podman compose» si no hay podman-compose). */
  dockerCompose: boolean;
  /** Dónde está la plantilla podman-compose@.service (vacío = en ninguna parte). */
  templates: string[];
  /** Proyectos registrados (tienen su `.env`). */
  registered: Set<string>;
  /** Proyectos con el enlace de `systemctl --user enable` (default.target.wants). */
  enabled: Set<string>;
}

export function parseComposeFacts(text: string): ComposeFacts {
  const f: ComposeFacts = { bin: null, dockerCompose: false, templates: [], registered: new Set(), enabled: new Set() };
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k === "bin") f.bin = v || null;
    else if (k === "dcompose") f.dockerCompose = v === "yes";
    else if (k === "template" && v) f.templates.push(v);
    else if (k === "registered" && v) f.registered.add(v);
    else if (k === "enabled" && v) f.enabled.add(v);
  }
  return f;
}

/** El servicio del proyecto arrancaría con el servidor: plantilla, registro y enlace (el linger va aparte). */
export function composeServiceReady(f: ComposeFacts, project: string): boolean {
  return f.templates.length > 0 && f.registered.has(project) && f.enabled.has(project);
}

/** Qué le falta al servicio, en palabras simples (para el «por qué»). */
export function composeServiceGaps(f: ComposeFacts, project: string): string[] {
  const out: string[] = [];
  if (!f.bin) out.push("podman-compose no está instalado para este usuario.");
  if (!f.templates.length) out.push(`No está la plantilla ${PC_TEMPLATE} (se crea con «podman-compose systemd -a create-unit»).`);
  if (!f.registered.has(project)) out.push(`El proyecto no está registrado en podman-compose (falta ~/${PC_PROJECTS_DIR}/${project}.env).`);
  if (!f.enabled.has(project)) out.push(`El servicio ${composeUnitName(project)} no está habilitado.`);
  return out;
}

// ───────── Decisión ─────────

export type ComposeStep = "linger" | "create-unit" | "register" | "enable";
export type ComposeChoice = "service" | "restart";

export interface ComposeTarget {
  project: string;
  /** Carpeta del proyecto (etiqueta com.docker.compose.project.working_dir). */
  dir: string | null;
  /** Archivos compose (etiqueta …config_files), relativos a `dir` o absolutos. */
  files: string[];
  /** Sus contenedores están en el pod «pod_<proyecto>» (el servicio de podman-compose lo arranca). */
  inPod: boolean;
}

export interface ComposeDecision {
  /** Lo recomendado. */
  choice: ComposeChoice;
  /** Se puede usar el servicio (hay podman-compose y se sabe la carpeta, o ya está registrado). */
  serviceOk: boolean;
  /** Pasos del servicio, en orden. */
  steps: ComposeStep[];
  /** Por qué, en una o dos frases. */
  why: string;
  /** Avisos para el servicio (p. ej. sin pod). */
  warnings: string[];
}

export function decideComposeAutostart(t: ComposeTarget, f: ComposeFacts, linger: boolean | null): ComposeDecision {
  const unit = composeUnitName(t.project);
  const template = f.templates.length > 0;
  const registered = f.registered.has(t.project);
  const serviceOk = !!f.bin && (registered || !!t.dir);
  const steps: ComposeStep[] = [
    ...(linger === false ? (["linger"] as const) : []),
    ...(template ? [] : (["create-unit"] as const)),
    ...(registered ? [] : (["register"] as const)),
    "enable",
  ];
  const warnings = t.inPod
    ? []
    : [`Sus contenedores no están en el pod «pod_${t.project}», y el servicio de podman-compose arranca ese pod: puede fallar al arrancar.`];
  const choice: ComposeChoice = serviceOk && t.inPod ? "service" : "restart";

  let why: string;
  if (!f.bin) {
    why =
      `${f.dockerCompose ? "Este usuario solo tiene el plugin docker-compose" : "podman-compose no está instalado para este usuario"}, así que ` +
      `el servicio ${unit} no puede funcionar. En su lugar, cada contenedor lleva la política de reinicio y podman-restart.service los arranca al encender.`;
  } else if (!serviceOk) {
    why = `No se sabe en qué carpeta está el proyecto, así que no se puede registrar en podman-compose. En su lugar se usa la política de reinicio.`;
  } else if (template && registered) {
    why = `El proyecto ya está registrado en podman-compose: falta habilitar su servicio ${unit} para que arranque con el servidor.`;
  } else {
    const what = [!template && "falta la plantilla de podman-compose", !registered && "el proyecto no está registrado"].filter(Boolean).join(" y ");
    why = `El servicio ${unit} todavía no existe (${what}). Se puede preparar ahora, como el dueño del proyecto.`;
  }
  return { choice, serviceOk, steps, why, warnings };
}

// ───────── Comandos del servicio ─────────

export interface ComposeCmdCtx {
  /** Dueño del proyecto (clave de `owner.ts`). */
  owner: string;
  /** `loginctl enable-linger`: con qué dueño y para qué usuario (null = el propio). */
  linger: { owner: string; user: string | null } | null;
}

/** Espera (hasta 20 s) a que arranque el gestor de systemd del usuario tras activar linger. */
function waitUserManager(user: string | null): string {
  const uid = user ? `$(id -u ${q(user)})` : "$(id -u)";
  return [
    `u=${uid}; i=0`,
    'while [ "$i" -lt 20 ] && [ ! -S "/run/user/$u/bus" ] && [ ! -S "/run/user/$u/systemd/private" ]; do sleep 1; i=$((i+1)); done',
  ].join("; ");
}

/** Escribe la plantilla que imprime podman-compose en el HOME del usuario (sin root no puede ir a /etc). */
const CREATE_UNIT_SCRIPT = [
  `d="$HOME/${USER_UNITS_DIR}"; t="$d/${PC_TEMPLATE}"`,
  `mkdir -p "$d" && podman-compose systemd -a create-unit >"$t.tmp" && grep -q '^ExecStart=' "$t.tmp" && mv -f "$t.tmp" "$t" ` +
    `|| { rm -f "$t.tmp"; echo 'podman-compose no devolvió la plantilla del servicio' >&2; exit 1; }`,
].join("; ");

/** Comandos (cada uno con su dueño) de los pasos del servicio. */
export function composeServiceCmds(t: ComposeTarget, steps: ComposeStep[], ctx: ComposeCmdCtx): Cmd[] {
  const own = (c: Cmd): Cmd => ({ ...c, owner: ctx.owner });
  const out: Cmd[] = [];
  if (steps.includes("linger") && ctx.linger) {
    const { owner, user } = ctx.linger;
    out.push({ bin: ["loginctl"], args: ["enable-linger", ...(user ? [user] : [])], owner });
    out.push({ bin: ["sh"], args: ["-c", waitUserManager(user)], owner });
  }
  if (steps.includes("create-unit")) out.push(own({ bin: ["sh"], args: ["-c", CREATE_UNIT_SCRIPT] }));
  if (steps.includes("register")) {
    out.push(
      own({
        bin: ["podman-compose"],
        args: ["-p", t.project, ...t.files.flatMap((f) => ["-f", f]), "systemd", "-a", "register"],
        ...(t.dir ? { cwd: t.dir } : {}),
      }),
    );
  }
  out.push(own({ bin: ["systemctl"], args: ["--user", "daemon-reload"] }));
  out.push(own({ bin: ["systemctl"], args: ["--user", "enable", "--now", composeUnitName(t.project)] }));
  return out;
}

/** Texto de cada paso para la revisión. */
export const COMPOSE_STEP_TEXT: Record<ComposeStep, string> = {
  linger: "Activar linger para el usuario (con sudo): así sus servicios arrancan con el servidor sin iniciar sesión.",
  "create-unit": `Crear la plantilla ${PC_TEMPLATE} en su carpeta de servicios (~/${USER_UNITS_DIR}).`,
  register: "Registrar el proyecto en podman-compose (desde su carpeta).",
  enable: "Habilitar y arrancar el servicio (systemctl --user enable --now).",
};
