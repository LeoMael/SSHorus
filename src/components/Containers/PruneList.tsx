// Lo que borraría «Limpiar sin usar» de Volúmenes y Redes: cuántos, como qué usuarios (con «Todos») y la lista.
import { splitByOwner } from "../../features/containers";
import type { CtContextValue } from "./context";

const LIST_MAX = 200;

export function PruneList<T extends { name: string; owner?: string }>({ items, noun, ct }: { items: T[]; noun: string; ct: CtContextValue }) {
  const groups = splitByOwner(items, "");
  return (
    <div>
      <div className="ct-summary">
        {items.length ? (
          <>
            <strong>{items.length}</strong> {noun}
          </>
        ) : (
          "No hay nada que borrar con esta opción."
        )}
      </div>
      {ct.allOwners && groups.length > 1 && (
        <div className="faint ct-small">Se limpia como cada usuario: {groups.map(([o, list]) => `${ct.ownerLabel(o)} (${list.length})`).join(" · ")}</div>
      )}
      <ul className="ct-list ct-list-scroll">
        {items.slice(0, LIST_MAX).map((it) => (
          <li key={`${it.owner ?? ""}/${it.name}`} className="mono">
            {it.name}
            {ct.allOwners && <span className="ct-tag">{ct.ownerLabel(it.owner)}</span>}
          </li>
        ))}
        {items.length > LIST_MAX && <li className="faint">… y {items.length - LIST_MAX} más</li>}
      </ul>
    </div>
  );
}
