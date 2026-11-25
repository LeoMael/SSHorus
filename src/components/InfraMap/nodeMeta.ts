// Icono y nombre de cada tipo de nodo del mapa y de cada estado (lo comparten el lienzo, la leyenda y
// el panel de detalles).
import type { ComponentType } from "react";
import { Box, Cpu, Database, Earth, ExternalLink, Globe, Plug, Server, Settings2, ShieldCheck, Waypoints, type LucideProps } from "lucide-react";
import type { Health, NodeKind } from "../../features/infra/graph";

export const NODE_ICON: Record<NodeKind, ComponentType<LucideProps>> = {
  internet: Earth,
  firewall: ShieldCheck,
  port: Plug,
  proxy: Waypoints,
  site: Globe,
  container: Box,
  service: Settings2,
  process: Cpu,
  db: Database,
  system: Server,
  external: ExternalLink,
};

export const KIND_LABEL: Record<NodeKind, string> = {
  internet: "Internet",
  firewall: "Cortafuegos",
  port: "Puerto expuesto",
  proxy: "Proxy web",
  site: "Sitio",
  container: "Contenedor",
  service: "Servicio",
  process: "Proceso",
  db: "Datos",
  system: "Sistema",
  external: "Externo",
};

export const HEALTH_LABEL: Record<Health, string> = { ok: "Bien", warn: "Aviso", bad: "Caído / error", off: "Parado o sin datos" };
