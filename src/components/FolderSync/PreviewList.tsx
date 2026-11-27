// Lista plegable de archivos de la comparación inicial (los primeros; el resto, contado).
import type { PlanItem } from "../../api/folderSync";
import { formatBytes, formatDate } from "../../lib/format";

const SHOWN = 50;

export function PreviewList({ title, items, showRemote }: { title: string; items: PlanItem[]; showRemote?: boolean }) {
  if (!items.length) return null;
  const rest = items.length - SHOWN;
  return (
    <details className="fs-list">
      <summary>
        {title} ({items.length.toLocaleString("es")})
      </summary>
      <ul>
        {items.slice(0, SHOWN).map((i) => (
          <li key={i.rel}>
            <span className="mono fs-rel" title={i.rel}>
              {i.rel}
            </span>
            <span className="faint">
              {showRemote ? `PC ${formatDate(i.localMtime)} · servidor ${formatDate(i.remoteMtime)}` : formatBytes(i.size)}
            </span>
          </li>
        ))}
        {rest > 0 && <li className="faint">y {rest.toLocaleString("es")} más…</li>}
      </ul>
    </details>
  );
}
