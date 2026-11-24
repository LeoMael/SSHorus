// Parseo de configuración de nginx (`nginx -T` o archivos sueltos) → lista de sitios.
import { detectNginxAccessLogs } from "./webTrafficLog";
import { parseUpstreamUrl, type Listen, type Site, type SiteRoute, type Target } from "./webTypes";

export interface NgxDirective {
  name: string;
  args: string[];
  block: NgxDirective[] | null;
  file: string;
  line: number;
}

interface Tok {
  t: string;
  /** Palabra (no { } ;). Las comillas ya se quitaron. */
  word: boolean;
  line: number;
}

/**
 * Quita los escapes de una palabra como lo hace nginx (igual dentro y fuera de comillas): «\"», «\'» y
 * «\\» dejan solo el carácter; «\t», «\r», «\n» son tabulador y saltos; cualquier otra barra se
 * conserva (así «location ~ \.php$» sigue siendo la expresión regular «\.php$»).
 */
export function unescapeNginx(raw: string): string {
  let w = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\" && i + 1 < raw.length) {
      const d = raw[i + 1];
      if (d === '"' || d === "'" || d === "\\") {
        w += d;
        i++;
        continue;
      }
      if (d === "t" || d === "r" || d === "n") {
        w += d === "t" ? "\t" : d === "r" ? "\r" : "\n";
        i++;
        continue;
      }
    }
    w += c;
  }
  return w;
}

/** Separa un archivo de nginx en palabras, «{», «}» y «;» (comentarios, comillas y ${var}). */
export function tokenizeNginx(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "#") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "{" || c === "}" || c === ";") {
      out.push({ t: c, word: false, line });
      i++;
      continue;
    }
    const start = line;
    let raw = "";
    if (c === '"' || c === "'") {
      i++;
      while (i < n && text[i] !== c) {
        if (text[i] === "\\" && i + 1 < n) {
          if (text[i + 1] === "\n") line++;
          raw += text[i] + text[i + 1];
          i += 2;
          continue;
        }
        if (text[i] === "\n") line++;
        raw += text[i++];
      }
      i++;
      out.push({ t: unescapeNginx(raw), word: true, line: start });
      continue;
    }
    while (i < n) {
      const d = text[i];
      if (d === " " || d === "\t" || d === "\n" || d === "\r" || d === ";" || d === "{" || d === "}") {
        if (d === "{" && raw.endsWith("$")) {
          const end = text.indexOf("}", i);
          if (end < 0) break;
          raw += text.slice(i, end + 1);
          i = end + 1;
          continue;
        }
        break;
      }
      if (d === "\\" && i + 1 < n) {
        if (text[i + 1] === "\n") line++;
        raw += d + text[i + 1];
        i += 2;
        continue;
      }
      raw += d;
      i++;
    }
    out.push({ t: unescapeNginx(raw), word: true, line: start });
  }
  return out;
}

/** Árbol de directivas de un archivo. Tolera llaves sin cerrar (devuelve lo leído). */
export function parseNginxFile(text: string, file: string): NgxDirective[] {
  const toks = tokenizeNginx(text);
  let i = 0;
  const parseBlock = (): NgxDirective[] => {
    const out: NgxDirective[] = [];
    while (i < toks.length) {
      const t = toks[i];
      if (!t.word && t.t === "}") {
        i++;
        return out;
      }
      if (!t.word) {
        i++;
        continue;
      }
      const name = t.t;
      const line = t.line;
      const args: string[] = [];
      i++;
      while (i < toks.length && toks[i].word) args.push(toks[i++].t);
      if (i >= toks.length) {
        out.push({ name, args, block: null, file, line });
        break;
      }
      const end = toks[i];
      i++;
      if (end.t === "{") out.push({ name, args, block: parseBlock(), file, line });
      else if (end.t === ";") out.push({ name, args, block: null, file, line });
      else {
        out.push({ name, args, block: null, file, line });
        return out;
      }
    }
    return out;
  };
  return parseBlock();
}

/** Separa la salida de `nginx -T` (o su imitación) en archivo → contenido. */
export function splitNginxDump(lines: string[]): Map<string, string> {
  const files = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const line of lines) {
    const m = /^# configuration file (.+):$/.exec(line);
    if (m) {
      cur = [];
      files.set(m[1], cur);
      continue;
    }
    if (cur) cur.push(line);
  }
  const out = new Map<string, string>();
  for (const [k, v] of files) out.set(k, v.join("\n"));
  return out;
}

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (const ch of glob) {
    if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

/** Árbol completo a partir del archivo principal, sustituyendo cada `include` por los archivos coincidentes. */
export function resolveNginx(files: Map<string, string>, main: string): NgxDirective[] {
  const parsed = new Map<string, NgxDirective[]>();
  const get = (f: string) => {
    let p = parsed.get(f);
    if (!p) {
      p = parseNginxFile(files.get(f) ?? "", f);
      parsed.set(f, p);
    }
    return p;
  };
  const prefix = dirname(main);
  const names = [...files.keys()];
  const expand = (dirs: NgxDirective[], stack: string[]): NgxDirective[] => {
    const out: NgxDirective[] = [];
    for (const d of dirs) {
      if (d.name === "include" && !d.block && d.args[0]) {
        const pat = d.args[0].startsWith("/") ? d.args[0] : `${prefix}/${d.args[0]}`;
        const re = globToRegExp(pat);
        const matches = names.filter((f) => re.test(f)).sort();
        for (const f of matches) {
          if (stack.includes(f)) continue;
          out.push(...expand(get(f), [...stack, f]));
        }
        continue;
      }
      out.push(d.block ? { ...d, block: expand(d.block, stack) } : d);
    }
    return out;
  };
  const first = files.has(main) ? main : (names[0] ?? main);
  return expand(get(first), [first]);
}

/** `listen 443 ssl`, `listen [::]:80 default_server`, `listen 127.0.0.1:8080`. */
export function parseNginxListen(args: string[]): Listen & { isDefault: boolean } {
  const a = args[0] ?? "80";
  const https = args.includes("ssl") || args.includes("quic") || args.includes("http3");
  const isDefault = args.includes("default_server") || args.includes("default");
  if (a.startsWith("unix:")) return { host: a, port: 0, https, isDefault };
  if (/^\d+$/.test(a)) return { host: null, port: Number(a), https, isDefault };
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(a);
  if (v6) return { host: v6[1] === "::" ? null : v6[1], port: v6[2] ? Number(v6[2]) : 80, https, isDefault };
  const i = a.lastIndexOf(":");
  const host = i > 0 ? a.slice(0, i) : a;
  const port = i > 0 ? Number(a.slice(i + 1)) : 80;
  return { host: host === "*" || host === "0.0.0.0" ? null : host, port: Number.isFinite(port) ? port : 80, https, isDefault };
}

const first = (dirs: NgxDirective[], name: string) => dirs.find((d) => d.name === name && !d.block) ?? null;

function ngxTarget(dirs: NgxDirective[], upstreams: Map<string, string[]>, inheritedRoot: string | null): Target | null {
  const proxy = dirs.find((d) => /^(proxy|grpc|uwsgi|scgi)_pass$/.test(d.name));
  if (proxy?.args[0]) {
    const url = proxy.args[0];
    const name = url.replace(/^[a-z]+:\/\//i, "").replace(/[/:].*$/, "");
    const ups = upstreams.get(name);
    const resolved = ups && ups.length ? ups[0] : null;
    const scheme = /^([a-z]+):\/\//i.exec(url)?.[1] ?? "http";
    const u = parseUpstreamUrl(resolved ? (resolved.startsWith("unix:") ? resolved : `${scheme}://${resolved}`) : url);
    return { kind: "proxy", url: resolved ? `${url} → ${ups!.join(", ")}` : url, ...u };
  }
  const fcgi = first(dirs, "fastcgi_pass");
  if (fcgi?.args[0]) {
    const u = parseUpstreamUrl(fcgi.args[0]);
    return { kind: "fastcgi", addr: fcgi.args[0], host: u.host, port: u.port };
  }
  const ret = first(dirs, "return");
  if (ret) {
    const code = /^\d{3}$/.test(ret.args[0] ?? "") ? Number(ret.args[0]) : null;
    const to = code === null ? (ret.args[0] ?? "") : (ret.args[1] ?? "");
    if (code !== null && (code < 300 || code >= 400)) return { kind: "other", text: `responde ${code}${to ? ` «${to}»` : ""}` };
    return { kind: "redirect", to, code };
  }
  const alias = first(dirs, "alias");
  if (alias?.args[0]) return { kind: "files", root: alias.args[0] };
  const root = first(dirs, "root");
  if (root?.args[0]) return { kind: "files", root: root.args[0] };
  if (inheritedRoot) return { kind: "files", root: inheritedRoot };
  return null;
}

function collectLocations(dirs: NgxDirective[], upstreams: Map<string, string[]>, root: string | null, out: SiteRoute[], parent = ""): void {
  for (const d of dirs) {
    if (d.name !== "location" || !d.block) continue;
    const path = `${parent ? `${parent} › ` : ""}${d.args.join(" ")}`;
    const ownRoot = first(d.block, "root")?.args[0] ?? root;
    const t = ngxTarget(d.block, upstreams, ownRoot);
    if (t) out.push({ path, target: t });
    collectLocations(d.block, upstreams, ownRoot, out, path);
  }
}

export function sitesFromNginx(tree: NgxDirective[], certs: Map<string, number | null>): Site[] {
  const http = tree.filter((d) => d.name === "http" && d.block).flatMap((d) => d.block!);
  const upstreams = new Map<string, string[]>();
  for (const d of http) {
    if (d.name === "upstream" && d.block && d.args[0]) {
      upstreams.set(
        d.args[0],
        d.block.filter((s) => s.name === "server" && s.args[0]).map((s) => s.args[0]),
      );
    }
  }
  const httpCert = first(http, "ssl_certificate")?.args[0] ?? null;
  const serverBlocks: NgxDirective[][] = [];
  const sites: Site[] = [];
  for (const srv of http) {
    if (srv.name !== "server" || !srv.block) continue;
    const b = srv.block;
    serverBlocks.push(b);
    const lst = b.filter((d) => d.name === "listen").map((d) => parseNginxListen(d.args));
    const listens: Listen[] = lst.length ? lst.map(({ host, port, https }) => ({ host, port, https })) : [{ host: null, port: 80, https: false }];
    const names = b
      .filter((d) => d.name === "server_name")
      .flatMap((d) => d.args)
      .filter((n) => n && n !== "_" && n !== '""');
    const https = listens.some((l) => l.https) || first(b, "ssl")?.args[0] === "on";
    const root = first(b, "root")?.args[0] ?? null;
    const routes: SiteRoute[] = [];
    const top = ngxTarget(b.filter((d) => d.name !== "root"), upstreams, null);
    if (top) routes.push({ path: "(todo el sitio)", target: top });
    collectLocations(b, upstreams, root, routes);
    if (routes.length === 0 && root) routes.push({ path: "/", target: { kind: "files", root } });
    const cert = https ? (first(b, "ssl_certificate")?.args[0] ?? httpCert) : null;
    sites.push({
      key: `nginx|${srv.file}|${srv.line}`,
      server: "nginx",
      names,
      listens,
      https,
      isDefault: lst.some((l) => l.isDefault),
      cert,
      certExpires: cert ? (certs.get(cert) ?? null) : null,
      routes,
      file: srv.file,
      line: srv.line,
    });
  }
  const logs = detectNginxAccessLogs(http, serverBlocks);
  sites.forEach((s, i) => {
    s.accessLog = logs[i];
  });
  return sites;
}
