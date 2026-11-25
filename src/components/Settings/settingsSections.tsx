// Secciones de Ajustes como datos: grupo, título, icono, texto para el buscador y qué componente se muestra.
import type { ComponentType, ReactNode } from "react";
import {
  ArrowLeftRight,
  BookOpen,
  Bot,
  FileCode2,
  FolderTree,
  Info,
  Keyboard,
  KeyRound,
  Laptop,
  MessageSquareText,
  Palette,
  Plug,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
} from "lucide-react";
import type { SectionId } from "./settingsNav";
import type { SearchableSection } from "./settingsSearch";
// El orden de estos imports fija el orden de su CSS en el paquete (el mismo que antes de partir Ajustes).
import { AppearanceSection } from "./AppearanceSection";
import { TerminalSection } from "./TerminalSection";
import { EditorSection } from "./EditorSection";
import { ExplorerSection } from "./ExplorerSection";
import { ConnectionSection } from "./ConnectionSection";
import { TransfersSection } from "./TransfersSection";
import { AdvancedSection, ManualSection } from "./SystemSections";
import { AboutSection } from "./AboutSection";
import { ServersSection } from "./ServersSection";
import { SecuritySection } from "./SecuritySection";
import { SshKeysSection } from "./SshKeysSection";
import { McpSection } from "./McpSection";
import { AiSection } from "./AiSection";
import { LocalAiSection } from "./LocalAiSection";
import { ShortcutsSection } from "./ShortcutsSection";

export interface SectionInfo extends SearchableSection {
  id: SectionId;
  icon: ReactNode;
  view: ComponentType;
  /** Sin la cabecera común (la sección trae la suya). */
  bare?: boolean;
}

export const NAV: { group: string; items: SectionInfo[] }[] = [
  {
    group: "General",
    items: [
      { id: "appearance", label: "Apariencia", icon: <Palette size={15} />, view: AppearanceSection, desc: "Tema de colores, acento y tamaño de la letra de la interfaz.", keys: "tema claro oscuro sistema color acento letra fuente tamaño medianoche arena fiordo alto contraste" },
      { id: "terminal", label: "Terminal", icon: <TerminalSquare size={15} />, view: TerminalSection, desc: "Letra, aceleración gráfica y sesiones persistentes.", keys: "letra fuente tamaño gpu webgl tmux persistentes" },
      { id: "editor", label: "Editor", icon: <FileCode2 size={15} />, view: EditorSection, desc: "Cómo se abren los archivos y con qué letra.", keys: "letra fuente tamaño dividido ventana pestaña máximo mb" },
      { id: "explorer", label: "Explorador", icon: <FolderTree size={15} />, view: ExplorerSection, desc: "Lista de archivos del servidor.", keys: "ocultos borrar confirmar" },
      { id: "shortcuts", label: "Atajos de teclado", icon: <Keyboard size={15} />, view: ShortcutsSection, desc: "Haz clic en un atajo para cambiarlo.", keys: "teclas teclado combinación ctrl paleta pestaña copiar pegar buscar" },
    ],
  },
  {
    group: "Conexiones",
    items: [
      { id: "connection", label: "Conexión", icon: <Plug size={15} />, view: ConnectionSection, desc: "Detección de cortes y reconexión automática.", keys: "keepalive señal de vida reconectar intentos desconexión" },
      { id: "transfers", label: "Transferencias", icon: <ArrowLeftRight size={15} />, view: TransfersSection, desc: "Subidas y descargas de archivos.", keys: "simultáneas sobrescribir omitir existe conflicto" },
      { id: "servers", label: "Servidores", icon: <Server size={15} />, view: ServersSection, desc: "Integración con la configuración de ssh del equipo.", keys: "ssh config exportar sincronizar alias" },
      { id: "sshKeys", label: "Llaves SSH", icon: <KeyRound size={15} />, view: SshKeysSection, desc: "Las llaves de este equipo: créalas y ponlas en un servidor o en GitHub.", keys: "llave clave ssh privada pública ed25519 rsa github authorized_keys crear generar" },
      { id: "security", label: "Seguridad", icon: <ShieldCheck size={15} />, view: SecuritySection, desc: "PIN o contraseña de la bóveda y bloqueo.", keys: "pin bloqueo bóveda contraseña inactividad" },
    ],
  },
  {
    group: "Inteligencia artificial",
    items: [
      { id: "assistants", label: "Asistentes de IA (MCP)", icon: <Bot size={15} />, view: McpSection, desc: "Claude, Codex, OpenCode y otros usan tus servidores con permiso, sin ver contraseñas ni llaves.", keys: "mcp claude codex opencode gemini token puerto permisos sudo emparejar conectar revocar asistentes" },
      { id: "localAi", label: "Terminal local e IA", icon: <Laptop size={15} />, view: LocalAiSection, desc: "Terminal de tu equipo y el contexto que reciben los asistentes (nunca contraseñas ni llaves).", keys: "local claude code codex agy antigravity opencode contexto carpeta" },
      { id: "ai", label: "IA para explicar informes", icon: <MessageSquareText size={15} />, view: AiSection, desc: "Modelo opcional que explica los informes del escáner.", keys: "openai ollama modelo url token escáner vulnerabilidades" },
    ],
  },
  {
    group: "Sistema",
    items: [
      { id: "advanced", label: "Avanzado", icon: <SlidersHorizontal size={15} />, view: AdvancedSection, desc: "Diagnóstico y datos para informar de fallos.", keys: "diagnóstico registro logs" },
      { id: "manual", label: "Manual de uso", icon: <BookOpen size={15} />, view: ManualSection, bare: true, desc: "Cómo se usa SSHorus, paso a paso.", keys: "ayuda guía" },
      { id: "about", label: "Acerca de", icon: <Info size={15} />, view: AboutSection, bare: true, desc: "Versión, actualizaciones y novedades.", keys: "versión actualizaciones novedades changelog" },
    ],
  },
];

export const ALL_SECTIONS = NAV.flatMap((g) => g.items);
