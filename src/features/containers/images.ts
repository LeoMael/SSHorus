// Imágenes: quién usa cada una, qué borraría «Limpiar sin usar», por qué no se puede y qué comando
// borra una selección. Funciones puras.
import { pruneImages, removeImages } from "./commands";
import { isObj, num, parseLabels, str, strList } from "./parsePrimitives";
import { ownedBy, perOwner } from "./owner";
import { pruneBlocked, pruneCmdsByOwner, type PruneTexts } from "./prune";
import type { Cmd } from "./shell";
import type { Container, Engine, ImageInfo } from "./types";

/** Normaliza una referencia para comparar («nginx» = «docker.io/library/nginx:latest»). */
export function normRef(ref: string): string {
  let r = ref.trim().toLowerCase();
  if (!r) return r;
  const lastSlash = r.lastIndexOf("/");
  if (!r.slice(lastSlash + 1).includes(":") && !r.includes("@")) r += ":latest";
  r = r.replace(/^docker\.io\/library\//, "").replace(/^docker\.io\//, "").replace(/^library\//, "");
  return r;
}

/** Contenedores que usan la imagen (por etiqueta o por id), del mismo dueño. */
export function usersOf(img: ImageInfo, containers: Container[]): Container[] {
  const tags = new Set(img.tags.map(normRef));
  return ownedBy(containers, img.owner).filter((c) => {
    const ref = c.image.replace(/^sha256:/, "").toLowerCase();
    if (ref.length >= 12 && /^[0-9a-f]+$/.test(ref) && img.id.startsWith(ref)) return true;
    return tags.has(normRef(c.image));
  });
}

/** Cuántos contenedores la usan (lo que dice el motor o los que encontramos, el mayor). */
export function inUseCount(img: ImageInfo, containers: Container[]): number {
  return Math.max(img.containers ?? 0, usersOf(img, containers).length);
}

/** Clave única de una fila (el mismo id puede estar en varios usuarios). */
export function imageKey(img: ImageInfo): string {
  return `${img.owner ?? ""}/${img.id}`;
}

/** Nombre corto para mostrar. */
export function imageLabel(img: ImageInfo): string {
  return img.tags[0] ?? `<sin nombre> ${img.shortId}`;
}

// ───────── Limpiar sin usar ─────────

/** «dangling»: solo las sin nombre (restos); «all»: también las que tienen nombre y no usa nadie (`-a`). */
export type PruneMode = "dangling" | "all";

/** Imágenes que borraría `image prune` (con `-a` si `mode` es «all»). */
export function pruneCandidates(images: ImageInfo[], containers: Container[], mode: PruneMode): ImageInfo[] {
  return images.filter((i) => inUseCount(i, containers) === 0 && (mode === "all" || i.dangling));
}

export interface PruneOwnerGroup {
  owner: string;
  images: ImageInfo[];
  bytes: number;
}

export interface PrunePreview {
  count: number;
  /** Suma de tamaños (máximo: las capas compartidas solo se liberan si nadie más las usa). */
  bytes: number;
  /** Por dueño, en el orden en que aparecen. */
  owners: PruneOwnerGroup[];
}

const sizeOf = (list: ImageInfo[]) => list.reduce((s, i) => s + (i.size ?? 0), 0);

export function prunePreview(images: ImageInfo[], containers: Container[], mode: PruneMode): PrunePreview {
  const list = pruneCandidates(images, containers, mode);
  const byOwner = new Map<string, ImageInfo[]>();
  for (const i of list) {
    const k = i.owner ?? "";
    byOwner.set(k, [...(byOwner.get(k) ?? []), i]);
  }
  return {
    count: list.length,
    bytes: sizeOf(list),
    owners: [...byOwner.entries()].map(([owner, imgs]) => ({ owner, images: imgs, bytes: sizeOf(imgs) })),
  };
}

/** Un `image prune` por cada dueño que tiene algo que limpiar (con «Todos», uno por usuario). */
export function pruneImagesCmds(engine: Engine, p: PrunePreview, mode: PruneMode): Cmd[] {
  return pruneCmdsByOwner(
    p.owners.flatMap((g) => g.images),
    { ...pruneImages(engine, mode === "all"), mergeStderr: true },
  );
}

const IMAGE_PRUNE_TEXTS: PruneTexts = {
  what: "las imágenes",
  none: "no hay imágenes en el servidor",
  allUsed: "todas las imágenes las usa algún contenedor (también los parados)",
};

/** Por qué «Limpiar sin usar» está desactivado (null = se puede). En minúscula, tras «Desactivado porque». */
export function pruneBlockedReason(r: { loaded: boolean; error: string | null; images: ImageInfo[]; containers: Container[] }): string | null {
  const candidates = r.loaded ? pruneCandidates(r.images, r.containers, "all").length : 0;
  return pruneBlocked({ loaded: r.loaded, error: r.error, total: r.images.length, candidates }, IMAGE_PRUNE_TEXTS);
}

// ───────── Eliminar una selección ─────────

/** Qué pasar a `rmi`: sus etiquetas (así no hace falta `-f` con varias) o el id si no tiene nombre. */
export function imageRefs(img: ImageInfo): string[] {
  return img.tags.length ? img.tags : [img.id];
}

export interface InUse {
  img: ImageInfo;
  users: Container[];
  count: number;
}

export interface RemovalPlan {
  /** Las que nadie usa: se borran sin más. */
  free: ImageInfo[];
  /** Las que usa algún contenedor: solo con «Forzar». */
  inUse: InUse[];
}

export function planImageRemoval(sel: ImageInfo[], containers: Container[]): RemovalPlan {
  const free: ImageInfo[] = [];
  const inUse: InUse[] = [];
  for (const img of sel) {
    const count = inUseCount(img, containers);
    if (count > 0) inUse.push({ img, users: usersOf(img, containers), count });
    else free.push(img);
  }
  return { free, inUse };
}

/** `rmi` por dueño. Sin `force`, las que están en uso se quedan fuera. */
export function removeImagesCmds(engine: Engine, plan: RemovalPlan, force: boolean, fallback: string): Cmd[] {
  const list = force ? [...plan.free, ...plan.inUse.map((u) => u.img)] : plan.free;
  return perOwner(list, fallback, (g) => removeImages(engine, g.flatMap(imageRefs), force));
}

/** Qué hace «Forzar» según el motor (Podman borra también los contenedores; Docker solo quita el nombre). */
export function forceWarning(engine: Engine): string {
  return engine === "podman"
    ? "Podman borra también los contenedores que la usan (y lo que tengan dentro fuera de sus volúmenes)."
    : "Docker le quita el nombre, pero la imagen se queda mientras algún contenedor la use.";
}

// ───────── Inspeccionar ─────────

export interface ImageDetails {
  id: string;
  tags: string[];
  digests: string[];
  created: string;
  size: number | null;
  os: string;
  arch: string;
  user: string;
  entrypoint: string[];
  cmd: string[];
  workdir: string;
  ports: string[];
  env: string[];
  labels: Record<string, string>;
}

/** Resumen de `image inspect` (Podman y Docker dan la misma forma). null si no es JSON válido. */
export function parseImageInspect(text: string): ImageDetails | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    return null;
  }
  const o = Array.isArray(raw) ? raw[0] : raw;
  if (!isObj(o)) return null;
  const cfg = isObj(o.Config) ? o.Config : {};
  return {
    id: str(o.Id).replace(/^sha256:/, ""),
    tags: strList(o.RepoTags),
    digests: strList(o.RepoDigests),
    created: str(o.Created),
    size: num(o.Size),
    os: str(o.Os),
    arch: str(o.Architecture),
    user: str(cfg.User),
    entrypoint: strList(cfg.Entrypoint),
    cmd: strList(cfg.Cmd),
    workdir: str(cfg.WorkingDir),
    ports: isObj(cfg.ExposedPorts) ? Object.keys(cfg.ExposedPorts) : [],
    env: strList(cfg.Env),
    labels: parseLabels(cfg.Labels),
  };
}

/** «Total reclaimed space: 1.2GB» → texto en español. */
export function reclaimed(stdout: string): string {
  const m = /total reclaimed space:\s*(.+)/i.exec(stdout);
  if (m) return `Espacio liberado: ${m[1].trim()}`;
  const n = stdout.split("\n").filter((l) => /^[0-9a-f]{12,}$|^deleted:|^untagged:/i.test(l.trim())).length;
  return n ? `${n} elementos eliminados` : "No había nada que limpiar";
}
