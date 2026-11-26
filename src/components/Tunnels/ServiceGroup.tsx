// Un grupo de «Servicios que puedes traer»: la categoría (etiqueta de color con icono), para qué sirve
// traerlo y sus servicios. «Otro» va plegado salvo que sea lo único que hay.
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { CategoryGroup, FoundService } from "../../features/tunnels";
import { CATEGORY_ICONS } from "./categoryIcons";

export interface ServiceGroupProps {
  group: CategoryGroup;
  /** Es el único grupo (se abre aunque sea «Otro»). */
  alone: boolean;
  row: (s: FoundService) => ReactNode;
}

export function ServiceGroup({ group, alone, row }: ServiceGroupProps) {
  const { category, items } = group;
  const Icon = CATEGORY_ICONS[category.id];
  const head = (
    <>
      <span className={`tn-cat-tag tn-cat-${category.id}`}>
        <Icon size={12} /> {category.label}
        <span className="tn-cat-count">{items.length}</span>
      </span>
      <span className="tn-cat-hint faint">{category.hint}</span>
    </>
  );
  const list = <ul className="tn-svc-list">{items.map(row)}</ul>;

  if (category.id === "other") {
    return (
      <details className="tn-cat tn-cat-fold" open={alone}>
        <summary className="tn-cat-head">
          <ChevronRight size={12} className="tn-cat-chevron" aria-hidden="true" />
          {head}
        </summary>
        {list}
      </details>
    );
  }
  return (
    <div className="tn-cat">
      <div className="tn-cat-head">{head}</div>
      {list}
    </div>
  );
}
