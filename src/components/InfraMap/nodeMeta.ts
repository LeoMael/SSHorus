// Icono y nombre de cada tipo de nodo del mapa y de cada estado (lo comparten el lienzo, la leyenda y
// el panel de detalles), y la medida del texto para recortar etiquetas al ancho de la tarjeta.
import type { ComponentType } from "react";
import {
  Box,
  CircleCheck,
  CirclePause,
  CircleX,
  Cpu,
  Database,
  Earth,
  ExternalLink,
  Globe,
  Plug,
  Server,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Waypoints,
  type LucideProps,
} from "lucide-react";
import type { Health, NodeKind } from "../../features/infra";

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

/** Icono de cada estado: el color no basta (daltonismo, impresión en gris). */
export const HEALTH_ICON: Record<Health, ComponentType<LucideProps>> = {
  ok: CircleCheck,
  warn: TriangleAlert,
  bad: CircleX,
  off: CirclePause,
};

export const HEALTH_LABEL: Record<Health, string> = { ok: "Bien", warn: "Aviso", bad: "Caído / error", off: "Parado o sin datos" };

let ctx: CanvasRenderingContext2D | null | undefined;
let family = "";

/** Ancho en píxeles de un texto con la fuente de la interfaz (con una estimación si no hay lienzo). */
export function textWidth(text: string, px: number, weight = 400): number {
  if (ctx === undefined) {
    ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    family = typeof document !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue("--font").trim() : "";
  }
  if (!ctx) return text.length * px * 0.6;
  ctx.font = `${weight} ${px}px ${family || "sans-serif"}`;
  return ctx.measureText(text).width;
}
