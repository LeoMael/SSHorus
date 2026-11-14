// Funciones puras de las pestañas locales (sin React ni Tauri), con pruebas en localterm.test.ts.
import type { AiTool } from "../../api/localterm";
import { localBasename } from "../../lib/platform";

/** Qué corre en la pestaña local. */
export type LocalKind = "shell" | AiTool;

/** Un asistente de IA, tal como lo muestra la interfaz (el motor tiene su tabla en tools.rs). */
export interface AssistantDef {
  tool: AiTool;
  label: string;
  /** Cómo se inicia sesión si hace falta (una frase). */
  login: string;
  /** Qué es el comando de instalación (una frase). */
  installNote: string;
  /** Página oficial. */
  url: string;
  /** Lo que no se le puede dar y por qué (una frase), o null si recibe contexto y MCP. */
  limits: string | null;
  /** Etiqueta corta para el menú cuando hay límites. */
  limitsTag: string | null;
}

/** Los asistentes, en el orden de los menús. Para añadir uno: aquí y en `TOOLS` de tools.rs. */
export const ASSISTANTS: readonly AssistantDef[] = [
  {
    tool: "claude",
    label: "Claude Code",
    login: "Si no has iniciado sesión, Claude Code te lo pedirá (o escribe /login).",
    installNote: "Es el instalador oficial de Anthropic (claude.ai/install).",
    url: "https://github.com/anthropics/claude-code",
    limits: null,
    limitsTag: null,
  },
  {
    tool: "codex",
    label: "Codex",
    login: "Si no has iniciado sesión, Codex te lo pedirá (o ejecuta «codex login»).",
    installNote:
      "Es el paquete oficial de OpenAI en npm. Si npm da un error de permisos (EACCES), configura npm para instalar en tu carpeta personal.",
    url: "https://github.com/openai/codex",
    limits: null,
    limitsTag: null,
  },
  {
    tool: "agy",
    label: "Antigravity (agy)",
    login: "Si no has iniciado sesión, agy te lo pedirá al abrirse.",
    installNote: "Es el instalador oficial de Google Antigravity (antigravity.google).",
    url: "https://antigravity.google/docs/getting-started",
    limits:
      "Recibe el contexto como primer mensaje. Sin MCP de SSHorus: agy solo lo lee de sus propios archivos de configuración, y SSHorus no los toca.",
    limitsTag: "sin MCP",
  },
  {
    tool: "opencode",
    label: "OpenCode",
    login: "Si no tienes un proveedor de IA configurado, OpenCode te lo pedirá.",
    installNote: "Es el instalador oficial de OpenCode (opencode.ai); en Windows, su paquete de npm.",
    url: "https://opencode.ai",
    limits: null,
    limitsTag: null,
  },
];

const BY_TOOL = new Map(ASSISTANTS.map((a) => [a.tool, a]));

/** Datos de un asistente. */
export function assistant(tool: AiTool): AssistantDef {
  return BY_TOOL.get(tool) ?? ASSISTANTS[0];
}

/** Nombre corto de la lista de asistentes: «Claude Code, Codex, Antigravity (agy) u OpenCode». */
export function assistantNames(joiner: "y" | "o" = "o"): string {
  const names = ASSISTANTS.map((a) => a.label);
  const last = names.pop() ?? "";
  // «o» delante de una palabra que empieza por «o» se escribe «u».
  const conj = joiner === "o" && /^[oO]/.test(last) ? "u" : joiner;
  return names.length ? `${names.join(", ")} ${conj} ${last}` : last;
}

export function kindLabel(kind: LocalKind): string {
  return kind === "shell" ? "Terminal local" : assistant(kind).label;
}

/** Título de la pestaña: la carpeta para una terminal; «Claude Code · carpeta» para un asistente. */
export function titleFor(kind: LocalKind, cwd: string | null): string {
  const dir = cwd ? localBasename(cwd) : null;
  if (kind === "shell") return dir || "Este equipo";
  return dir ? `${kindLabel(kind)} · ${dir}` : kindLabel(kind);
}

/** Pestaña a mostrar al cerrar `id`: la de la izquierda, o la siguiente si era la primera. */
export function pickNeighbor(ids: readonly string[], id: string): string | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return ids[i - 1] ?? ids[i + 1] ?? null;
}
