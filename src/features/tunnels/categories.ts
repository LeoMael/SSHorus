// Categorías de «Servicios que puedes traer»: qué tipo de servicio es (base de datos, web…), para qué
// sirve traerlo y en qué orden se muestran. Solo datos y funciones puras; los iconos y colores, en la interfaz.
import type { FoundService } from "./detect";

export type ServiceCategory = "db" | "web" | "cache" | "queue" | "search" | "monitor" | "screen" | "other";

export interface CategoryDef {
  id: ServiceCategory;
  label: string;
  /** Para qué sirve traerlo, en una frase. */
  hint: string;
}

/** Orden = orden en la lista. */
export const CATEGORIES: CategoryDef[] = [
  { id: "db", label: "Base de datos", hint: "Ábrela con DBeaver u otro programa de bases de datos, con la cadena de conexión." },
  { id: "web", label: "Web / panel", hint: "Ábrelo en el navegador de tu PC, como si estuviera en tu equipo." },
  { id: "cache", label: "Caché", hint: "Para que tu aplicación en tu PC lo use, o para mirarlo con RedisInsight." },
  { id: "queue", label: "Cola de mensajes", hint: "Para que tu aplicación en tu PC envíe o reciba mensajes, o para ver su panel." },
  { id: "search", label: "Búsqueda", hint: "Consúltalo desde el navegador, Kibana o tu aplicación." },
  { id: "monitor", label: "Monitoreo", hint: "Ábrelo en el navegador para ver gráficas y alertas del servidor." },
  { id: "screen", label: "Escritorio remoto", hint: "Ábrelo con un visor para ver y usar el escritorio del servidor." },
  { id: "other", label: "Otro", hint: "No se sabe qué es: tráelo solo si sabes para qué sirve." },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<ServiceCategory, CategoryDef>;

export function categoryOf(s: FoundService): ServiceCategory {
  return s.service?.category ?? "other";
}

export interface CategoryGroup {
  category: CategoryDef;
  items: FoundService[];
}

/** Los servicios agrupados por categoría, en el orden de CATEGORIES (sin grupos vacíos). */
export function groupByCategory(services: FoundService[]): CategoryGroup[] {
  return CATEGORIES.map((category) => ({ category, items: services.filter((s) => categoryOf(s) === category.id) })).filter(
    (g) => g.items.length > 0,
  );
}
