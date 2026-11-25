// Revisiones de Imágenes: eliminar una selección (las que están en uso, solo con «Forzar») y «Limpiar sin
// usar» (vista previa de lo que se borra y el espacio, y luego en segundo plano como cada dueño).
import { AlertTriangle } from "lucide-react";
import {
  forceWarning,
  imageLabel,
  planImageRemoval,
  pruneImagesCmds,
  prunePreview,
  removeImagesCmds,
  type Container,
  type ImageInfo,
  type PruneMode,
} from "../../features/containers";
import { formatBytes } from "../../lib/format";
import type { CtContextValue } from "./context";

const LIST_MAX = 200;

function ImageList({ images, ct }: { images: ImageInfo[]; ct: CtContextValue }) {
  return (
    <ul className="ct-list ct-list-scroll">
      {images.slice(0, LIST_MAX).map((i) => (
        <li key={`${i.owner ?? ""}/${i.id}`} className="mono">
          {imageLabel(i)} <span className="faint">{i.size !== null ? formatBytes(i.size) : ""}</span>
          {ct.allOwners && <span className="ct-tag">{ct.ownerLabel(i.owner)}</span>}
        </li>
      ))}
      {images.length > LIST_MAX && <li className="faint">… y {images.length - LIST_MAX} más</li>}
    </ul>
  );
}

/** Eliminar las imágenes elegidas (una o varias, de uno o varios usuarios). */
export function askRemoveImages(ct: CtContextValue, sel: ImageInfo[], containers: Container[], onDone?: () => void) {
  const plan = planImageRemoval(sel, containers);
  const one = sel.length === 1;
  ct.review({
    title: one ? `Eliminar la imagen ${imageLabel(sel[0])}` : `Eliminar ${sel.length} imágenes`,
    message: plan.inUse.length
      ? "Algunas las usa un contenedor (aunque esté parado): sin «Forzar» se quedan y se borran las demás. Podrás volver a descargarlas."
      : "Se borran del servidor. Podrás volver a descargarlas.",
    options: plan.inUse.length ? [{ key: "force", label: "Forzar: borrar también las que están en uso (-f)" }] : undefined,
    details: (o) => (
      <div>
        {plan.free.length > 0 && <ImageList images={plan.free} ct={ct} />}
        {plan.inUse.length > 0 && (
          <>
            <div className="ct-warn-text">
              <AlertTriangle size={13} /> En uso{o.force ? " (se borran igualmente)" : " (se quedan)"}:
            </div>
            <ul className="ct-list ct-list-scroll">
              {plan.inUse.map((u) => (
                <li key={`${u.img.owner ?? ""}/${u.img.id}`}>
                  <span className="mono">{imageLabel(u.img)}</span>{" "}
                  <span className="faint">
                    {u.users.length ? `la usa ${u.users.map((c) => c.name).join(", ")}` : `la usan ${u.count} contenedores`}
                  </span>
                </li>
              ))}
            </ul>
            {o.force && <div className="ct-bad-text">{forceWarning(ct.engine)}</div>}
          </>
        )}
      </div>
    ),
    build: (o) => removeImagesCmds(ct.engine, plan, !!o.force, ct.newOwner ?? "self"),
    danger: true,
    runLabel: "Eliminar",
    timeoutSecs: 300,
    success: one ? "Imagen eliminada" : "Imágenes eliminadas",
    reload: ["images", "containers", "df"],
    onDone,
  });
}

const MODE_TEXT: Record<PruneMode, string> = {
  dangling: "Solo las «sin nombre»: restos de compilaciones y de actualizaciones (cuando bajas una versión nueva, la vieja se queda sin nombre).",
  all: "También las que tienen nombre pero no usa ningún contenedor: se libera más, pero si las vuelves a necesitar hay que descargarlas otra vez.",
};

function PruneDetails({ mode, images, containers, ct }: { mode: PruneMode; images: ImageInfo[]; containers: Container[]; ct: CtContextValue }) {
  const p = prunePreview(images, containers, mode);
  const df = ct.allOwners ? null : ct.res.df.data?.find((d) => d.type.toLowerCase() === "images");
  return (
    <div>
      <div className="faint ct-small">{MODE_TEXT[mode]}</div>
      <div className="ct-summary">
        {p.count ? (
          <>
            <strong>{p.count}</strong> imágenes · se liberan hasta <strong>{formatBytes(p.bytes)}</strong>
          </>
        ) : (
          "No hay ninguna que borrar con esta opción."
        )}
        {df && df.reclaimable !== null && <span className="faint"> · según «{ct.engine} system df», recuperable: {formatBytes(df.reclaimable)}</span>}
      </div>
      {ct.allOwners && p.owners.length > 1 && (
        <div className="faint ct-small">
          Se limpia como cada usuario: {p.owners.map((g) => `${ct.ownerLabel(g.owner)} (${g.images.length}, ${formatBytes(g.bytes)})`).join(" · ")}
        </div>
      )}
      <div className="faint ct-small">Las capas compartidas entre imágenes solo se liberan si nadie más las usa: el espacio real puede ser menor.</div>
      {p.count > 0 && <ImageList images={p.owners.flatMap((g) => g.images)} ct={ct} />}
    </div>
  );
}

/** «Limpiar sin usar»: por defecto solo las sin nombre; con `-a`, todas las que no usa nadie. */
export function askPruneImages(ct: CtContextValue, images: ImageInfo[], containers: Container[]) {
  if (!ct.allOwners && ct.res.df.loadedAt === 0) void ct.reload("df");
  const modeOf = (o: Record<string, boolean>): PruneMode => (o.all ? "all" : "dangling");
  ct.review({
    title: "Limpiar imágenes sin usar",
    message: "Borra imágenes que no usa ningún contenedor (ni siquiera uno parado). Antes, revisa qué se borra y cuánto espacio se libera.",
    options: [{ key: "all", label: "Incluir también las que tienen nombre (-a)" }],
    details: (o) => <PruneDetails mode={modeOf(o)} images={images} containers={containers} ct={ct} />,
    build: (o) => pruneImagesCmds(ct.engine, prunePreview(images, containers, modeOf(o)), modeOf(o)),
    danger: true,
    runLabel: "Limpiar",
    success: "Imágenes sin usar eliminadas",
    background: (cmds) =>
      ct.startJob({
        title: "Limpiar imágenes",
        detail: `${cmds.length > 1 ? `${cmds.length} usuarios` : ct.ownerLabel(cmds[0]?.owner ?? ct.newOwner ?? undefined)}`,
        key: "images|prune",
        owner: cmds[0]?.owner ?? ct.newOwner ?? "self",
        cmds,
        success: "Imágenes sin usar eliminadas",
        timeoutSecs: 900,
        onFinished: () => void ct.reload("images", "df"),
      }),
  });
}
