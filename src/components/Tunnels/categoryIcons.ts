// Icono de cada categoría de servicio (el color va en Services.css: .tn-cat-<categoría>).
import { Activity, Database, Globe, Layers, Monitor, Plug, Search, Zap, type LucideIcon } from "lucide-react";
import type { ServiceCategory } from "../../features/tunnels";

export const CATEGORY_ICONS: Record<ServiceCategory, LucideIcon> = {
  db: Database,
  web: Globe,
  cache: Zap,
  queue: Layers,
  search: Search,
  monitor: Activity,
  screen: Monitor,
  other: Plug,
};
