// Imágenes: listar, elegir (casillas), ver detalles, descargar (pull), eliminar, crear contenedor y limpiar
// las que no se usan. Con «Todos», cada acción va como el dueño de cada imagen.
import { useEffect, useMemo, useReducer, useState, type KeyboardEvent } from "react";
import { Brush, Download, RefreshCw, Search, Trash2, X } from "lucide-react";
import {
  allSelected,
  imageKey,
  inUseCount,
  pruneBlockedReason,
  selectionReducer,
  someSelected,
  type ImageInfo,
} from "../../features/containers";
import { PICK_OWNER_HINT, useCt } from "./context";
import { PullDialog } from "./PullDialog";
import { ImageDetailsDialog } from "./ImageDetailsDialog";
import { ImageRow } from "./ImageRow";
import { askPruneImages, askRemoveImages } from "./imageActions";

type SortKey = "name" | "owner" | "size" | "created";

export function ImagesTab() {
  const ct = useCt();
  const { res } = ct;
  const images = useMemo(() => res.images.data ?? [], [res.images.data]);
  const containers = useMemo(() => res.containers.data ?? [], [res.containers.data]);
  const [search, setSearch] = useState("");
  const [showDangling, setShowDangling] = useState(false);
  /** null = cerrado; si no, imagen precargada y con qué usuario se descarga. */
  const [pull, setPull] = useState<{ ref: string; owner?: string } | null>(null);
  const [details, setDetails] = useState<ImageInfo | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [selected, dispatch] = useReducer(selectionReducer, new Set<string>());

  // Tras recargar, se olvidan las que ya no existen.
  useEffect(() => dispatch({ type: "retain", keys: images.map(imageKey) }), [images]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return images
      .filter((i) => (showDangling ? true : !i.dangling))
      .filter(
        (i) =>
          !s ||
          i.tags.some((t) => t.toLowerCase().includes(s)) ||
          i.shortId.includes(s) ||
          (ct.allOwners && ct.ownerLabel(i.owner).toLowerCase().includes(s)),
      )
      .sort((a, b) => {
        const v = (i: ImageInfo) =>
          sort.key === "name"
            ? (i.tags[0] ?? "~").toLowerCase()
            : sort.key === "owner"
              ? `${ct.ownerLabel(i.owner)} ${(i.tags[0] ?? "~").toLowerCase()}`
              : sort.key === "size"
                ? (i.size ?? 0)
                : (i.created ?? 0);
        const x = v(a);
        const y = v(b);
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, search, showDangling, sort, ct.allOwners, ct.ownerLabel]);

  const rowKeys = useMemo(() => rows.map(imageKey), [rows]);
  // Solo las visibles: lo que se ve es lo que se borra.
  const sel = rows.filter((i) => selected.has(imageKey(i)));
  const dangling = images.filter((i) => i.dangling).length;
  const pruneReason = pruneBlockedReason({ loaded: res.images.data !== null, error: res.images.error, images, containers });

  const remove = (list: ImageInfo[]) => askRemoveImages(ct, list, containers, () => dispatch({ type: "clear" }));

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, img: ImageInfo) => {
    if (e.target !== e.currentTarget) return;
    const tr = e.currentTarget;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      ((e.key === "ArrowDown" ? tr.nextElementSibling : tr.previousElementSibling) as HTMLElement | null)?.focus();
    } else if (e.key === " ") {
      e.preventDefault();
      dispatch({ type: "toggle", key: imageKey(img) });
    } else if (e.key === "Enter") {
      setDetails(img);
    } else if (e.key === "Delete") {
      remove(selected.has(imageKey(img)) && sel.length > 1 ? sel : [img]);
    } else if (e.key.toLowerCase() === "a" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      dispatch({ type: "toggleAll", keys: rowKeys });
    }
  };

  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === "name" ? 1 : -1 }));
  const th = (key: SortKey, label: string, cls: string) => (
    <th className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className="ct-th" onClick={() => sortBy(key)}>
        {label}
        {sort.key === key && <span className="ct-sort">{sort.dir === 1 ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  return (
    <div className="ct-tab-body">
      <div className="ct-toolbar">
        <div className="ct-search">
          <Search size={13} />
          <input className="input" placeholder="Buscar imagen" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar imágenes" />
          {search && (
            <button className="icon-btn" onClick={() => setSearch("")} aria-label="Limpiar búsqueda">
              <X size={12} />
            </button>
          )}
        </div>
        <label className="checkbox" title="Imágenes sin nombre (restos de compilaciones o actualizaciones)">
          <input type="checkbox" checked={showDangling} onChange={(e) => setShowDangling(e.target.checked)} /> Mostrar sin nombre ({dangling})
        </label>
        <span className="faint">{images.length} imágenes</span>
        <span className="ct-grow" />
        <button className="icon-btn" onClick={() => void ct.reload("images", "containers")} title="Actualizar" aria-label="Actualizar" disabled={res.images.loading}>
          <RefreshCw size={14} className={res.images.loading ? "ct-spin" : undefined} />
        </button>
        <button className="btn btn-sm" onClick={() => askPruneImages(ct, images, containers)} disabled={!!pruneReason} aria-describedby={pruneReason ? "ct-prune-why" : undefined}>
          <Brush size={13} /> Limpiar sin usar
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => setPull({ ref: "" })} disabled={!ct.newOwner} title={ct.newOwner ? undefined : PICK_OWNER_HINT}>
          <Download size={13} /> Descargar imagen
        </button>
      </div>
      {(pruneReason || !ct.newOwner) && (
        <div className="faint ct-small ct-why" id="ct-prune-why">
          {pruneReason && <>«Limpiar sin usar» está desactivado porque {pruneReason}. </>}
          {!ct.newOwner && <>Para descargar una imagen, elige arriba con qué usuario.</>}
        </div>
      )}
      {sel.length > 0 && (
        <div className="ct-batch" role="toolbar" aria-label="Imágenes elegidas">
          <strong>{sel.length === 1 ? "1 elegida" : `${sel.length} elegidas`}</strong>
          <button className="btn btn-sm ct-btn-danger" onClick={() => remove(sel)}>
            <Trash2 size={13} /> Eliminar…
          </button>
          <button className="btn btn-sm" onClick={() => dispatch({ type: "clear" })}>
            Quitar selección
          </button>
        </div>
      )}
      {res.images.error && (
        <div className="ct-error ct-error-inline" role="alert">
          <pre>{res.images.error}</pre>
          <button className="btn btn-sm" onClick={() => void ct.reload("images")}>
            Reintentar
          </button>
        </div>
      )}
      <div className="ct-table-wrap">
        {res.images.data === null && res.images.loading ? (
          <div className="empty-state">
            <span className="spinner" />
            <div>Leyendo imágenes…</div>
          </div>
        ) : (
          <table className="ct-table">
            <thead>
              <tr>
                <th className="ct-col-chk">
                  <input
                    type="checkbox"
                    aria-label="Elegir todas las imágenes visibles"
                    checked={allSelected(selected, rowKeys)}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected(selected, rowKeys);
                    }}
                    onChange={() => dispatch({ type: "toggleAll", keys: rowKeys })}
                    disabled={!rows.length}
                  />
                </th>
                {th("name", "Imagen", "ct-col-name")}
                {ct.allOwners && th("owner", "Usuario", "ct-col-owner")}
                <th className="ct-col-id">ID</th>
                {th("size", "Tamaño", "ct-col-num")}
                {th("created", "Creada", "ct-col-created")}
                <th className="ct-col-state">En uso</th>
                <th className="ct-col-actions">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((img) => (
                <ImageRow
                  key={imageKey(img)}
                  img={img}
                  inUse={inUseCount(img, containers)}
                  selected={selected.has(imageKey(img))}
                  onToggle={() => dispatch({ type: "toggle", key: imageKey(img) })}
                  onKeyDown={(e) => onRowKey(e, img)}
                  onDetails={() => setDetails(img)}
                  onPull={() => setPull({ ref: img.tags[0] ?? "", owner: img.owner })}
                  onRemove={() => remove([img])}
                />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={ct.allOwners ? 8 : 7} className="ct-norows">
                    {images.length ? "Ninguna imagen coincide" : "No hay imágenes. Descarga una con «Descargar imagen»."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {pull !== null && <PullDialog initial={pull.ref} owner={pull.owner} onClose={() => setPull(null)} />}
      {details && <ImageDetailsDialog image={details} onClose={() => setDetails(null)} />}
    </div>
  );
}
