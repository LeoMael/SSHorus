// Mini-intérprete de Markdown, la parte pura (sin React): de texto a bloques, texto plano, anclas tipo
// GitHub y CHANGELOG por versiones. Lo pinta components/About/markdown.tsx (historial de cambios, manual
// y «Novedades»).
// Soporta: encabezados (#…######), listas con guion, asterisco o número (con líneas de continuación y un
// nivel de anidado), párrafos, citas (>), bloques de código (```), líneas horizontales y tablas. El
// formato en línea (negrita, enlaces, imágenes…) se interpreta al pintar.

export type Align = "left" | "center" | "right" | null;
export interface ListItem {
  text: string;
  children: string[];
  childrenOrdered: boolean;
}

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "para"; text: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "code"; text: string }
  | { type: "hr" }
  | { type: "table"; head: string[]; align: Align[]; rows: string[][] };

const LIST_RE = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Divide una fila de tabla `| a | b |` en celdas (respeta `\|` y el `código`). */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "`") {
      // Un `código` (o ``código con ` dentro``) va entero a la celda, aunque tenga |.
      let n = 1;
      while (s[i + n] === "`") n++;
      const fence = "`".repeat(n);
      let end = s.indexOf(fence, i + n);
      while (end !== -1 && s[end + n] === "`") end = s.indexOf(fence, end + n + 1);
      const stop = end === -1 ? i + n : end + n;
      cur += s.slice(i, stop);
      i = stop - 1;
    } else if (c === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function cellAlign(sep: string): Align {
  const t = sep.trim();
  const l = t.startsWith(":");
  const r = t.endsWith(":");
  return l && r ? "center" : r ? "right" : l ? "left" : null;
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: { ordered: boolean; start: number; items: ListItem[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ type: "para", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", ...list });
    list = null;
  };
  const flushAll = () => {
    flushPara();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    // Un comentario al final de una línea (`texto <!-- … -->`) tampoco se muestra.
    const raw = lines[i];
    const line = (/^\s*<!--/.test(raw) ? raw : raw.replace(/\s*<!--.*?-->/g, "")).replace(/\s+$/, "");
    if (!line.trim()) {
      flushPara();
      // Una línea en blanco no corta la lista si sigue otro elemento; se decide en la siguiente línea.
      continue;
    }
    // Comentarios HTML (también de varias líneas): no se muestran.
    if (/^\s*<!--/.test(line)) {
      while (i < lines.length && !lines[i].includes("-->")) i++;
      continue;
    }
    // Bloque de código ```…```
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flushAll();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)(?:\s+#+)?$/.exec(line);
    if (h) {
      flushAll();
      blocks.push({ type: "heading", level: h[1].length, text: h[2] });
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}$/.test(line)) {
      flushAll();
      blocks.push({ type: "hr" });
      continue;
    }
    // Tabla: fila de cabecera con | seguida de la fila separadora |---|:--:|
    if (line.includes("|") && i + 1 < lines.length && lines[i + 1].includes("|") && TABLE_SEP_RE.test(lines[i + 1])) {
      flushAll();
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map(cellAlign);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes("|"); i++) rows.push(splitRow(lines[i]));
      i--;
      blocks.push({ type: "table", head, align, rows });
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      flushAll();
      const inner: string[] = [];
      for (; i < lines.length && /^\s{0,3}>/.test(lines[i]); i++) inner.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
      i--;
      blocks.push({ type: "quote", blocks: parseMarkdown(inner.join("\n")) });
      continue;
    }
    const li = LIST_RE.exec(line);
    if (li) {
      flushPara();
      const nested = li[1].length >= 2;
      const ordered = /\d/.test(li[2]);
      if (nested && list && list.items.length) {
        const last = list.items[list.items.length - 1];
        if (!last.children.length) last.childrenOrdered = ordered;
        last.children.push(li[3]);
        continue;
      }
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, start: ordered ? parseInt(li[2], 10) || 1 : 1, items: [] };
      list.items.push({ text: li[3], children: [], childrenOrdered: false });
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // Continuación del último elemento (o de su último hijo).
      const last = list.items[list.items.length - 1];
      if (last.children.length) last.children[last.children.length - 1] += " " + line.trim();
      else last.text += " " + line.trim();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushAll();
  return blocks;
}

/** Texto plano de un trozo en Markdown (sin `código`, **negrita**, enlaces ni imágenes). */
export function plainText(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(`+)\s?(.*?[^`])\s?\1(?!`)/g, "$2")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?![\w*])/g, "$1$2")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .trim();
}

/**
 * Ancla de un encabezado como la genera GitHub: minúsculas, sin puntuación ni emojis (se conservan
 * letras acentuadas, números, `_` y `-`) y cada espacio cambiado por un guion.
 */
export function slugify(heading: string): string {
  return plainText(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

export interface ChangelogRelease {
  /** "0.3.0" o "Sin publicar". */
  version: string;
  date: string | null;
  body: string;
}

/** Divide el CHANGELOG en versiones (encabezados `## [x.y.z] - fecha`). Ignora la introducción. */
export function splitChangelog(src: string): ChangelogRelease[] {
  const out: ChangelogRelease[] = [];
  let cur: ChangelogRelease | null = null;
  for (const line of src.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /^##\s+\[?([^\]\s]+(?:\s[^\]]+)?)\]?(?:\s*-\s*(.+))?\s*$/.exec(line);
    if (m && !line.startsWith("###")) {
      cur = { version: m[1], date: m[2]?.trim() ?? null, body: "" };
      out.push(cur);
    } else if (cur) {
      cur.body += line + "\n";
    }
  }
  return out.map((r) => ({ ...r, body: r.body.trim() }));
}
