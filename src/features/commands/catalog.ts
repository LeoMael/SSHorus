// Catálogo base de la Biblioteca de comandos (fuente: docs/comandos/CATALOGO.md).
// Datos en catalogContainers.ts y catalogSystem.ts; aquí los tipos, pistas y construcción.
import { parseVars } from "./template";
import type { McpTask } from "../../api/mcp";
import { PODMAN_SECTIONS, type CatalogRow, type CatalogSection } from "./catalogContainers";
import { SYSTEM_SECTIONS } from "./catalogSystem";

export type Distro = "rpm" | "deb" | "apk";

export interface CatalogVar {
  label?: string;
  /** Comando que lista opciones, una por línea ("valor<TAB>detalle" opcional). */
  suggest?: string;
  /** Opciones fijas. */
  options?: string[];
  default?: string;
}

export interface CatalogEntry {
  id: string;
  category: string;
  group: string;
  name: string;
  description?: string;
  command: string;
  dangerous: boolean;
  sudo: boolean;
  readOnly: boolean;
  interactive?: boolean;
  distro?: Distro;
  vars?: Record<string, CatalogVar>;
  perm?: McpTask;
}

export const CATEGORIES = [
  "Podman",
  "Docker",
  "Análisis del sistema",
  "Procesos",
  "Discos y archivos",
  "Red",
  "Servicios",
  "Logs",
  "Usuarios",
  "Paquetes",
  "Seguridad",
  "Web",
  "Git",
] as const;

export const DISTRO_LABEL: Record<Distro, string> = {
  rpm: "Fedora/RHEL",
  deb: "Debian/Ubuntu",
  apk: "Alpine",
};

const VAR_HINTS: Record<string, CatalogVar> = {
  contenedor: { suggest: "podman ps -a --format '{{.Names}}'" },
  imagen: { suggest: "podman images --format '{{.Repository}}:{{.Tag}}' | grep -v '<none>'" },
  pod: { suggest: "podman pod ps --format '{{.Name}}'" },
  volumen: { suggest: "podman volume ls --format '{{.Name}}'" },
  red: { suggest: "podman network ls --format '{{.Name}}'" },
  servicio: { suggest: "systemctl list-units --type=service --all --no-legend --plain --no-pager | awk '{print $1}'" },
  usuario: { suggest: "awk -F: '$3>=1000 || $3==0 {print $1}' /etc/passwd" },
  clave_publica: { label: "clave pública" },
  admin: { label: "dar sudo", options: ["no", "si"] },
  linger: { options: ["no", "si"] },
  grupo: { suggest: "cut -d: -f1 /etc/group" },
  rama: { suggest: "git branch -a --format='%(refname:short)'" },
  pid: { suggest: "ps -eo pid=,comm= --sort=-pcpu 2>/dev/null | head -40 | awk '{print $1\"\\t\"$2}'" },
  shell: { options: ["sh", "bash", "ash", "zsh"] },
  accion: { label: "acción", options: ["start", "stop", "restart", "reload", "status"] },
  desde: { options: ["10m", "1h", "6h", "24h"] },
  lineas: { label: "líneas", options: ["50", "100", "200", "500", "1000"] },
  tamaño: { options: ["10M", "100M", "500M", "1G"] },
  nuevo_shell: { label: "shell nuevo", suggest: "grep '^/' /etc/shells 2>/dev/null | sort -u" },
  dominio: { label: "dominio (app.ejemplo.com)" },
  puerto: { label: "puerto local" },
  carpeta: { suggest: "find . -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort | head -50" },
  archivo: { suggest: "find . -maxdepth 1 -type f 2>/dev/null | sort | head -50" },
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function swapEngine(cmd: string): string {
  return cmd.replace(/\bpodman\b/g, "docker");
}

function varsFor(command: string, docker: boolean): Record<string, CatalogVar> | undefined {
  const vars = parseVars(command);
  if (vars.length === 0) return undefined;
  const out: Record<string, CatalogVar> = {};
  for (const v of vars) {
    const hint = VAR_HINTS[v.name] ?? {};
    out[v.name] = {
      ...hint,
      suggest: hint.suggest && docker ? swapEngine(hint.suggest) : hint.suggest,
      default: v.default,
    };
  }
  return out;
}

const CATEGORY_PERM: Partial<Record<string, McpTask>> = {
  Podman: "containers",
  Docker: "containers",
  Servicios: "services",
  Paquetes: "packages",
  Web: "web",
};

function build(sections: CatalogSection[], docker = false): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const ids = new Set<string>();
  for (const sec of sections) {
    for (const [name, command, description, flags = "", distro, fixedId] of sec.rows) {
      let id = `${slug(sec.category)}.${fixedId ?? slug(name)}${distro ? `-${distro}` : ""}`;
      for (let n = 2; ids.has(id); n++) id = `${slug(sec.category)}.${slug(name)}-${n}`;
      ids.add(id);
      out.push({
        id,
        category: sec.category,
        group: sec.group,
        name,
        description,
        command,
        dangerous: flags.includes("d"),
        sudo: flags.includes("s"),
        readOnly: flags.includes("r"),
        interactive: flags.includes("i") || undefined,
        distro,
        vars: varsFor(command, docker),
        perm: sec.perm ?? CATEGORY_PERM[sec.category],
      });
    }
  }
  return out;
}

/** Docker: mismas entradas que Podman (sin pods, Quadlet ni auto-update), más extras. */
function dockerSections(): CatalogSection[] {
  const skipGroups = new Set(["Arranque automático con systemd"]);
  const out: CatalogSection[] = [];
  for (const sec of PODMAN_SECTIONS) {
    if (skipGroups.has(sec.group)) continue;
    const rows = sec.rows
      .filter(([, cmd]) => !/\bpodman pod\b/.test(cmd))
      .map(([name, cmd, desc, flags, distro]): CatalogRow => [
        name.replace(/Podman/g, "Docker"),
        swapEngine(cmd).replace(/:Z(\s)/g, "$1"),
        desc,
        flags,
        distro,
      ]);
    out.push({
      category: "Docker",
      group: sec.group === "Pods, volúmenes y redes" ? "Volúmenes y redes" : sec.group,
      rows,
    });
  }
  out.push({
    category: "Docker",
    group: "Servicio Docker",
    rows: [
      ["Reiniciar Docker", "sudo systemctl restart docker", "Reinicia el servicio de Docker (y sus contenedores).", "s"],
      ["Estado de Docker", "systemctl status docker --no-pager", "Si el servicio de Docker está activo.", "r"],
    ],
  });
  return out;
}

export const CATALOG: CatalogEntry[] = [...build(PODMAN_SECTIONS), ...build(dockerSections(), true), ...build(SYSTEM_SECTIONS)];

/** Pista de variable por nombre (para "Mis comandos"). */
export function varHint(name: string): CatalogVar | undefined {
  return VAR_HINTS[name];
}
