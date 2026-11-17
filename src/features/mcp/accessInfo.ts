// Datos de los niveles de acceso del asistente, las casillas de «Solo lo marcado» y las plantillas, y el
// resumen por servidor. Las reglas se aplican en el motor (src-tauri/src/mcp/grants.rs y protect.rs); aquí
// solo están los textos y lo que se muestra. Funciones puras.
import type { McpAccess, McpConfig, McpGrants, McpTask, McpTemplate } from "../../api/mcp";

export const ACCESS: { v: McpAccess; label: string; title: string }[] = [
  { v: "none", label: "Sin acceso", title: "El asistente ni ve este servidor." },
  { v: "read", label: "Solo lectura", title: "Listar, leer archivos y comandos 📊 de la Biblioteca." },
  { v: "custom", label: "Solo lo marcado", title: "Lecturas y las tareas que marques, siempre con tu permiso." },
  { v: "full", label: "Completo", title: "También cambios, siempre con tu permiso." },
];

export const TASKS: { v: McpTask; label: string; hint: string }[] = [
  { v: "users-create", label: "Usuarios: crear", hint: "Crear usuarios (con contraseña o solo con llave SSH)." },
  { v: "users-edit", label: "Usuarios: editar", hint: "Grupos, shell, bloquear y desbloquear, dar sudo." },
  { v: "users-delete", label: "Usuarios: borrar", hint: "Borrar usuarios (nunca root ni el usuario conectado)." },
  { v: "web", label: "Sitios web", hint: "Caddy y nginx: ver, crear, editar, borrar y recargar." },
  { v: "containers", label: "Contenedores", hint: "Podman y Docker." },
  { v: "services", label: "Servicios", hint: "systemd: iniciar, detener, reiniciar, activar." },
  { v: "packages", label: "Paquetes", hint: "Instalar, actualizar y desinstalar." },
  { v: "firewall", label: "Cortafuegos", hint: "Abrir puertos (firewalld o ufw)." },
  { v: "files", label: "Archivos", hint: "Guardar y subir archivos, solo dentro de las carpetas que elijas." },
];

/** Igual que `grants::Template::tasks` en el motor (solo para marcar la plantilla que coincide). */
export const TEMPLATES: { v: McpTemplate; label: string; tasks: McpTask[] }[] = [
  { v: "users", label: "Solo usuarios", tasks: ["users-create", "users-edit", "users-delete"] },
  { v: "web", label: "Solo web", tasks: ["web"] },
  { v: "deploy", label: "Despliegue", tasks: ["users-create", "users-edit", "users-delete", "web", "containers", "services"] },
  { v: "all", label: "Todo", tasks: TASKS.map((t) => t.v) },
];

export const EMPTY_GRANTS: McpGrants = { tasks: [], folders: [], freeCommands: false };

export const accessOf = (cfg: McpConfig | null, id: string): McpAccess => cfg?.access[id] ?? "none";
export const grantsOf = (cfg: McpConfig | null, id: string): McpGrants => cfg?.grants?.[id] ?? EMPTY_GRANTS;

/** Los suyos más los globales, sin repetir. */
export function protectedOf(cfg: McpConfig | null, id: string): string[] {
  return [...new Set([...(cfg?.protectedGlobal ?? []), ...(cfg?.protectedUsers?.[id] ?? [])])].sort();
}

/** Niveles con «Aceptar automáticamente» (con «Solo lo marcado», solo dentro de lo marcado). */
export const allowsAuto = (a: McpAccess) => a === "full" || a === "custom";

/** Plantilla que coincide exactamente con las casillas (sin comandos libres), o null. */
export function matchingTemplate(g: McpGrants): McpTemplate | null {
  if (g.freeCommands) return null;
  const have = [...g.tasks].sort().join(",");
  return TEMPLATES.find((t) => [...t.tasks].sort().join(",") === have)?.v ?? null;
}

/** «Usuarios: crear, Sitios web» · «Comandos libres (todo)» · «Nada marcado». */
export function tasksText(g: McpGrants): string {
  if (g.freeCommands) return "Comandos libres (todo)";
  const labels = TASKS.filter((t) => g.tasks.includes(t.v)).map((t) =>
    t.v === "files" && g.folders.length ? `Archivos en ${g.folders.join(", ")}` : t.v === "files" ? "Archivos (sin carpetas)" : t.label,
  );
  return labels.length ? labels.join(", ") : "Nada marcado";
}

/** Nombres de una lista escrita a mano: separados por comas o espacios, sin repetir. */
export function parseNames(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((n) => n.trim()).filter(Boolean))];
}

/** Error de un nombre (mismas reglas que el motor) o null. No hace falta que exista en el servidor. */
export function nameError(name: string): string | null {
  return /^[A-Za-z0-9._$-]{1,64}$/.test(name) ? null : `«${name}» no es un nombre de usuario válido`;
}

/** Carpeta absoluta sin «..» (el motor la normaliza igual), o null. */
export function cleanFolder(raw: string): string | null {
  const t = raw.trim();
  if (!t.startsWith("/")) return null;
  const parts: string[] = [];
  for (const p of t.split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") parts.pop();
    else parts.push(p);
  }
  return `/${parts.join("/")}`;
}

export interface ServerSummary {
  access: McpAccess;
  accessLabel: string;
  /** Qué puede cambiar (vacío con «Sin acceso»). */
  can: string;
  protectedUsers: string[];
}

export function summarize(cfg: McpConfig | null, id: string): ServerSummary {
  const access = accessOf(cfg, id);
  const label = ACCESS.find((a) => a.v === access)?.label ?? access;
  const can =
    access === "none"
      ? "Nada (no lo ve)"
      : access === "read"
        ? "Solo leer"
        : access === "full"
          ? "Todo, con tu permiso"
          : tasksText(grantsOf(cfg, id));
  return { access, accessLabel: label, can, protectedUsers: protectedOf(cfg, id) };
}
