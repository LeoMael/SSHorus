// Mini-intérprete de Markdown para el historial de cambios y el manual (sin dependencias): la vista.
// Lo puro (de texto a bloques) está en lib/markdown.ts.
// Soporta: encabezados (#…######, con ancla tipo GitHub), listas con guion, asterisco o número (con
// líneas de continuación y un nivel de anidado), párrafos, citas (>), bloques de código (```), líneas
// horizontales, tablas, **negrita**, *cursiva*, `código`, <kbd>teclas</kbd>, [enlaces](https://…),
// enlaces internos [texto](#ancla) e imágenes ![texto](ruta) (si quien lo usa sabe resolverlas).
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { parseMarkdown, slugify, type Block } from "../../lib/markdown";

/** Lo que el visor necesita saber del documento: cómo convertir la ruta de una imagen en una URL. */
export interface MarkdownEnv {
  /** Devuelve la URL de la imagen (o null si no existe). Sin esta función, las imágenes muestran su texto. */
  resolveImage?: (src: string) => Promise<string | null> | string | null;
}
const MarkdownCtx = createContext<MarkdownEnv>({});

/** Formato en línea: `código`, ![imagen](ruta), **negrita**, [texto](url), <kbd>tecla</kbd> y *cursiva*. */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Sin «lookbehind» (no existe en WebKit antiguos): el carácter previo a la cursiva va capturado en m[9].
  const re =
    /(`+)\s?(.*?[^`])\s?\1(?!`)|!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|<kbd>(.*?)<\/kbd>|(^|[^\w*])\*([^*\s][^*]*?)\*(?![\w*])/g;
  let last = 0;
  let key = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] !== undefined) out.push(<code key={key++}>{m[1].length > 1 ? m[2].trim() : m[2]}</code>);
    else if (m[4] !== undefined) out.push(<MdImage key={key++} src={m[4]} alt={m[3]} />);
    else if (m[5] !== undefined) out.push(<strong key={key++}>{renderInline(m[5])}</strong>);
    else if (m[6] !== undefined) out.push(<Link key={key++} href={m[7]} label={m[6]} />);
    else if (m[8] !== undefined) out.push(<kbd key={key++}>{m[8]}</kbd>);
    else if (m[10] !== undefined) {
      if (m[9]) out.push(m[9]);
      out.push(<em key={key++}>{renderInline(m[10])}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Desplaza el visor hasta el encabezado con esa ancla (dentro del mismo documento). */
function scrollToAnchor(from: HTMLElement, anchor: string) {
  let id = anchor;
  try {
    id = decodeURIComponent(anchor);
  } catch {
    /* ancla mal escrita: se busca tal cual */
  }
  const root = from.closest("[data-md-root]");
  const target = root?.querySelector(`[data-anchor="${CSS.escape(id.toLowerCase())}"]`);
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Link({ href, label }: { href: string; label: string }) {
  if (href.startsWith("#")) {
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          scrollToAnchor(e.currentTarget, href.slice(1));
        }}
      >
        {renderInline(label)}
      </a>
    );
  }
  if (!/^https?:\/\//i.test(href)) return <>{renderInline(label)}</>;
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void openUrl(href);
      }}
    >
      {renderInline(label)}
    </a>
  );
}

/** Imagen del documento: se carga bajo demanda y se amplía con un clic. */
function MdImage({ src, alt }: { src: string; alt: string }) {
  const { resolveImage } = useContext(MarkdownCtx);
  const [url, setUrl] = useState<string | null | undefined>(resolveImage ? undefined : null);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (!resolveImage) return;
    let alive = true;
    Promise.resolve(resolveImage(src)).then(
      (u) => alive && setUrl(u),
      () => alive && setUrl(null),
    );
    return () => {
      alive = false;
    };
  }, [src, resolveImage]);

  useEffect(() => {
    if (!zoom) return;
    // En fase de captura y antes que nadie: Escape cierra la imagen, no la ventana de debajo.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setZoom(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zoom]);

  if (url === undefined) return <span className="ab-md-img ab-md-img-loading" role="img" aria-label={alt} />;
  if (url === null) return <span className="ab-md-img-missing">{alt ? `[Imagen: ${alt}]` : "[Imagen]"}</span>;
  return (
    <>
      <button type="button" className="ab-md-img" onClick={() => setZoom(true)} title="Clic para ampliar">
        <img src={url} alt={alt} loading="lazy" decoding="async" draggable={false} />
      </button>
      {zoom &&
        createPortal(
          <div className="ab-md-zoom" role="dialog" aria-modal="true" aria-label={alt || "Imagen"} onClick={() => setZoom(false)}>
            <img src={url} alt={alt} />
            {alt && <div className="ab-md-zoom-caption">{alt}</div>}
          </div>,
          document.body,
        )}
    </>
  );
}

export function Markdown({ source, className, env }: { source: string; className?: string; env?: MarkdownEnv }) {
  const content = (
    <div className={className} data-md-root="">
      {renderBlocks(parseMarkdown(source))}
    </div>
  );
  return env ? <MarkdownCtx.Provider value={env}>{content}</MarkdownCtx.Provider> : content;
}

const HEADING_TAGS = ["h2", "h3", "h4", "h5", "h6", "h6"] as const;

function renderList(ordered: boolean, items: ReactNode[], key: number, start = 1) {
  return ordered ? (
    <ol key={key} start={start !== 1 ? start : undefined}>
      {items}
    </ol>
  ) : (
    <ul key={key}>{items}</ul>
  );
}

/** `slugs` cuenta las anclas ya usadas en el documento (para hacerlas únicas como GitHub). */
export function renderBlocks(blocks: Block[], slugs: Map<string, number> = new Map()): ReactNode {
  return blocks.map((b, i) => {
    switch (b.type) {
      case "heading": {
        const Tag = HEADING_TAGS[b.level - 1];
        const base = slugify(b.text);
        const n = slugs.get(base) ?? 0;
        slugs.set(base, n + 1);
        return (
          <Tag key={i} data-anchor={n ? `${base}-${n}` : base}>
            {renderInline(b.text)}
          </Tag>
        );
      }
      case "list":
        return renderList(
          b.ordered,
          b.items.map((it, j) => (
            <li key={j}>
              {renderInline(it.text)}
              {it.children.length > 0 &&
                renderList(
                  it.childrenOrdered,
                  it.children.map((c, k) => <li key={k}>{renderInline(c)}</li>),
                  0,
                )}
            </li>
          )),
          i,
          b.start,
        );
      case "quote":
        return <blockquote key={i}>{renderBlocks(b.blocks, slugs)}</blockquote>;
      case "code":
        return (
          <pre key={i}>
            <code>{b.text}</code>
          </pre>
        );
      case "hr":
        return <hr key={i} />;
      case "table": {
        const style = (k: number) => (b.align[k] ? { textAlign: b.align[k] ?? undefined } : undefined);
        return (
          <div key={i} className="ab-md-table">
            <table>
              <thead>
                <tr>
                  {b.head.map((c, k) => (
                    <th key={k} style={style(k)}>
                      {renderInline(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {b.head.map((_, k) => (
                      <td key={k} style={style(k)}>
                        {renderInline(r[k] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      default:
        return <p key={i}>{renderInline(b.text)}</p>;
    }
  });
}
