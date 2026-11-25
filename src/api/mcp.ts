// Servidor MCP para asistentes de IA (motor: src-tauri/src/mcp/).
import { call } from "./core";

/** Payload: `ApprovalRequest`. El asistente pide permiso para algo. */
export const EV_MCP_APPROVAL = "mcp://approval";
/** Payload: id. La petición ya no está pendiente (respondida o vencida). */
export const EV_MCP_APPROVAL_DONE = "mcp://approval-done";
/** Payload: `AuditEntry`. Una acción del asistente empezó, cambió o terminó. */
export const EV_MCP_ACTIVITY = "mcp://activity";
/** Payload: `McpStatus`. */
export const EV_MCP_STATUS = "mcp://status";
/** Payload: `McpAutoState[]`. Cambió «Aceptar automáticamente» de algún servidor. */
export const EV_MCP_AUTO = "mcp://auto";
/** Payload: `McpUiRequest`. El motor pide algo a la interfaz. */
export const EV_MCP_UI_REQUEST = "mcp://ui-request";
/** Payload: `McpPairPrompt`. Un asistente pide emparejarse. */
export const EV_MCP_PAIR_REQUEST = "mcp://pair-request";
/** Payload: id. La petición de emparejado ya no está pendiente. */
export const EV_MCP_PAIR_DONE = "mcp://pair-done";
/** Payload: `McpPairedClient[]`. Cambió la lista de asistentes emparejados. */
export const EV_MCP_PAIRED = "mcp://paired";

/** Acceso del asistente a un servidor. «custom» = Solo lo marcado (casillas por tarea). */
export type McpAccess = "none" | "read" | "full" | "custom";

/** Casillas de «Solo lo marcado» (el mismo código es el `perm` de los comandos de la Biblioteca). */
export type McpTask =
  | "users-create"
  | "users-edit"
  | "users-delete"
  | "web"
  | "containers"
  | "services"
  | "packages"
  | "firewall"
  | "files";

export interface McpGrants {
  tasks: McpTask[];
  /** Carpetas absolutas donde se puede escribir con «files». */
  folders: string[];
  /** run_command y cualquier comando: las casillas ya no limitan. */
  freeCommands: boolean;
}

export type McpTemplate = "users" | "web" | "deploy" | "all";

/** Cambios para uno o varios servidores (lo que falta no se toca). */
export interface McpRules {
  access?: McpAccess;
  /** Implica «Solo lo marcado» si no se da `access`. */
  template?: McpTemplate;
  grants?: McpGrants;
  /** Usuarios protegidos del servidor (reemplaza la lista). */
  protected?: string[];
}

export interface McpConfig {
  enabled: boolean;
  port: number;
  approvalTimeoutSecs: number;
  /** id de servidor → acceso (lo que falta = "none"). */
  access: Record<string, McpAccess>;
  /** id de servidor → acciones con «Permitir siempre». */
  remembered: Record<string, string[]>;
  /** id de servidor → «Aceptar automáticamente» guardado («siempre»). */
  autoAccept: Record<string, McpAutoLevel>;
  /** La IA puede pedir VER la contraseña de sudo (`request_sudo_password`; apagado por defecto, siempre pregunta). */
  allowSudoReveal: boolean;
  /** id de servidor → casillas de «Solo lo marcado» (puede faltar). */
  grants?: Record<string, McpGrants>;
  /** id de servidor → usuarios protegidos. */
  protectedUsers?: Record<string, string[]>;
  /** Usuarios protegidos en todos los servidores. */
  protectedGlobal?: string[];
}

/** «Aceptar automáticamente»: apagado, cambios normales o todo (también lo peligroso y sudo). */
export type McpAutoLevel = "off" | "changes" | "all";
/** Cuánto dura: lo temporal vive solo en memoria; «always» se guarda en mcp.json. */
export type McpAutoDuration = "15m" | "1h" | "session" | "always";

export interface McpAutoState {
  serverId: string;
  serverName: string;
  level: McpAutoLevel;
  /** Unix ms en que se apaga; null = hasta cerrar SSHorus o guardado (`saved`). */
  until: number | null;
  saved: boolean;
}

export interface McpStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  url: string;
  error: string | null;
  approvalTimeoutSecs: number;
  /** Puente para las configuraciones: el de la ruta fija si ya está copiado; si no, el del paquete. */
  bridgePath: string;
  bridgeFound: boolean;
  /** `bridgePath` es la ruta fija (~/.local/bin o %LOCALAPPDATA%\SSHorus\bin): no cambia con la AppImage. */
  bridgeStable: boolean;
  /** «sshorus-mcp pair», o con la ruta completa si esa carpeta no está en PATH. */
  pairCommand: string;
  appImage: boolean;
  auditPath: string | null;
}

/** Un asistente pide emparejarse (lo que vio el puente en este equipo, sin comprobar). */
export interface McpPairPrompt {
  id: string;
  clientId: string;
  name: string;
  program: string;
  pid: number | null;
  cwd: string | null;
  /** Ya estaba emparejado: aceptar reemplaza su token. */
  replaces: boolean;
  /** Permisos que ya tenía (si se reemplaza). */
  current: Record<string, McpAccess>;
  timeoutSecs: number;
  /** Unix ms en que se rechaza solo. */
  expiresAt: number;
}

/** Un asistente emparejado: sus permisos por servidor son los únicos que valen para él. */
export interface McpPairedClient {
  id: string;
  name: string;
  program: string;
  cwd: string | null;
  /** Unix ms. */
  createdAt: number;
  lastUsed: number | null;
  /** id de servidor → acceso (lo que falta = "none"). */
  access: Record<string, McpAccess>;
}

export interface McpClientConfig {
  claudeCodeStdio: string;
  claudeCodeHttp: string;
  claudeDesktopJson: string;
  url: string;
  token: string;
}

export interface McpApprovalRequest {
  id: string;
  serverId: string;
  serverName: string;
  tool: string;
  title: string;
  command: string;
  diff: string | null;
  danger: string[];
  canRemember: boolean;
  timeoutSecs: number;
  /** Unix ms en que se deniega solo. */
  expiresAt: number;
  client: string | null;
}

export type McpDecision = "once" | "always" | "deny";

export type AuditStatus = "running" | "ok" | "error" | "denied" | "locked";

export interface AuditEntry {
  id: string;
  /** Unix ms. */
  at: number;
  tool: string;
  serverId: string | null;
  serverName: string | null;
  detail: string;
  status: AuditStatus;
  approvedBy: string | null;
  message: string | null;
  durationMs: number | null;
  client: string | null;
  /** Asistente emparejado que lo hizo (falta con el token general). */
  clientId?: string | null;
  execId?: string | null;
  /** La aceptó el modo «Aceptar automáticamente». */
  auto?: boolean;
  /** Aceptada automáticamente aunque era peligrosa o con sudo. */
  autoDanger?: boolean;
}

export interface McpUiRequest {
  id: string;
  kind: "connect" | "catalog" | "ports" | "sites" | "containers" | "sudo" | "sudo-reveal" | "sudo-rejected" | "password-run" | "password-prompt" | string;
  payload: Record<string, unknown>;
}

export const mcp = {
  status: () => call<McpStatus>("mcp_status"),
  setEnabled: (enabled: boolean) => call<McpStatus>("mcp_set_enabled", { enabled }),
  setPort: (port: number) => call<McpStatus>("mcp_set_port", { port }),
  setApprovalTimeout: (secs: number) => call<McpConfig>("mcp_set_approval_timeout", { secs }),
  config: () => call<McpConfig>("mcp_config"),
  setSudoPasswordRequest: (allow: boolean) => call<McpConfig>("mcp_set_sudo_password_request", { allow }),
  setAccess: (serverId: string, access: McpAccess) => call<McpConfig>("mcp_set_access", { serverId, access }),
  /** Nivel, casillas, plantilla o protegidos para uno o varios servidores. */
  applyRules: (serverIds: string[], rules: McpRules) => call<McpConfig>("mcp_apply_rules", { serverIds, rules }),
  setProtectedGlobal: (users: string[]) => call<McpConfig>("mcp_set_protected_global", { users }),
  /** Borra una regla «Permitir siempre» (o todas las del servidor si `key` es null). */
  forgetRule: (serverId: string, key: string | null) => call<McpConfig>("mcp_forget_rule", { serverId, key }),
  getToken: () => call<string>("mcp_get_token"),
  regenerateToken: () => call<string>("mcp_regenerate_token"),
  clientConfig: () => call<McpClientConfig>("mcp_client_config"),
  pendingApprovals: () => call<McpApprovalRequest[]>("mcp_pending_approvals"),
  reply: (id: string, decision: McpDecision) => call<boolean>("mcp_approval_reply", { id, decision }),
  uiReply: (id: string, ok: boolean, value: unknown, error: string | null) =>
    call<boolean>("mcp_ui_reply", { id, ok, value: value ?? null, error }),
  activity: () => call<AuditEntry[]>("mcp_activity"),
  autoList: () => call<McpAutoState[]>("mcp_auto_list"),
  setAuto: (serverId: string, level: McpAutoLevel, duration: McpAutoDuration) =>
    call<McpAutoState[]>("mcp_set_auto", { serverId, level, duration }),
  autoOffAll: () => call<McpAutoState[]>("mcp_auto_off_all"),
  clearActivity: () => call<void>("mcp_activity_clear"),
  pairPending: () => call<McpPairPrompt[]>("mcp_pair_pending"),
  /** Respuesta del diálogo de emparejado. false si ya no estaba pendiente. */
  pairReply: (id: string, accept: boolean, access: Record<string, McpAccess>) =>
    call<boolean>("mcp_pair_reply", { id, accept, access }),
  pairedClients: () => call<McpPairedClient[]>("mcp_paired_clients"),
  pairedSetAccess: (clientId: string, access: Record<string, McpAccess>) =>
    call<McpPairedClient[]>("mcp_paired_set_access", { clientId, access }),
  pairedRevoke: (clientId: string) => call<McpPairedClient[]>("mcp_paired_revoke", { clientId }),
};
