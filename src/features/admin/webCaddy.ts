// Parseo de configuración JSON de Caddy (API local o `caddy adapt`) → lista de sitios.
import { detectCaddyAccessLogs } from "./webTrafficLog";
import { parseUpstreamUrl, type Site, type SiteRoute } from "./webTypes";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");

/** «:443», «0.0.0.0:80», «[::1]:8080», «tcp/:443» → host/puerto. */
export function parseCaddyListen(s: string): { host: string | null; port: number } | null {
  const a = s.replace(/^[a-z0-9]+\//i, "");
  const i = a.lastIndexOf(":");
  if (i < 0) return null;
  const port = Number(a.slice(i + 1).replace(/-.*$/, ""));
  if (!Number.isFinite(port) || port <= 0) return null;
  const host = a.slice(0, i).replace(/^\[|\]$/g, "");
  return { host: host && host !== "0.0.0.0" && host !== "::" ? host : null, port };
}

/** Añade a `out` lo que hacen los manejadores y devuelve la carpeta raíz vigente al terminar. */
function caddyTargets(handlers: unknown[], path: string, root: string | null, out: SiteRoute[]): string | null {
  let curRoot = root;
  for (const h of handlers) {
    if (!isObj(h)) continue;
    switch (h.handler) {
      case "vars":
        if (typeof h.root === "string") curRoot = h.root;
        break;
      case "reverse_proxy": {
        const dials = arr(h.upstreams)
          .map((u) => (isObj(u) && typeof u.dial === "string" ? u.dial : null))
          .filter((d): d is string => !!d);
        const tr = isObj(h.transport) ? h.transport : null;
        const fastcgi = tr?.protocol === "fastcgi";
        const u = parseUpstreamUrl(dials[0] ?? "");
        if (fastcgi) out.push({ path, target: { kind: "fastcgi", addr: dials.join(", "), host: u.host, port: u.port } });
        else out.push({ path, target: { kind: "proxy", url: dials.join(", ") || "(dinámico)", ...u } });
        break;
      }
      case "file_server":
        out.push({ path, target: { kind: "files", root: typeof h.root === "string" ? h.root : (curRoot ?? "(carpeta actual)") } });
        break;
      case "static_response": {
        const headers = isObj(h.headers) ? h.headers : {};
        const loc = strs(headers.Location)[0];
        const code = typeof h.status_code === "number" ? h.status_code : Number(h.status_code) || null;
        if (loc) out.push({ path, target: { kind: "redirect", to: loc, code } });
        else out.push({ path, target: { kind: "other", text: `responde ${code ?? 200}` } });
        break;
      }
      case "subroute":
        for (const r of arr(h.routes)) {
          if (!isObj(r)) continue;
          const paths = arr(r.match).flatMap((m) => (isObj(m) ? strs(m.path) : []));
          const p = paths.length ? paths.join(", ") : path;
          const after = caddyTargets(arr(r.handle), p, curRoot, out);
          // «root * /srv» (vars sin condición) vale para las rutas siguientes del mismo bloque.
          if (arr(r.match).length === 0) curRoot = after;
        }
        break;
    }
  }
  return curRoot;
}

export function sitesFromCaddy(cfg: unknown, configPath: string): Site[] {
  const servers = isObj(cfg) && isObj(cfg.apps) && isObj(cfg.apps.http) && isObj(cfg.apps.http.servers) ? cfg.apps.http.servers : {};
  const byHost = new Map<string, Site>();
  const order: Site[] = [];
  for (const [name, srv] of Object.entries(servers)) {
    if (!isObj(srv)) continue;
    const listens = strs(srv.listen)
      .map(parseCaddyListen)
      .filter((l): l is { host: string | null; port: number } => !!l);
    const auto = isObj(srv.automatic_https) ? srv.automatic_https : {};
    const tls = arr(srv.tls_connection_policies).length > 0 || listens.some((l) => l.port === 443);
    const https = tls && auto.disable !== true;
    let srvRoot: string | null = null;
    for (const route of arr(srv.routes)) {
      if (!isObj(route)) continue;
      const hosts = arr(route.match).flatMap((m) => (isObj(m) ? strs(m.host) : []));
      const paths = arr(route.match).flatMap((m) => (isObj(m) ? strs(m.path) : []));
      const routes: SiteRoute[] = [];
      const after = caddyTargets(arr(route.handle), paths.length ? paths.join(", ") : "/", srvRoot, routes);
      if (arr(route.match).length === 0) srvRoot = after;
      const k = `caddy|${name}|${[...hosts].sort().join(",")}`;
      let site = byHost.get(k);
      if (!site && routes.length === 0 && hosts.length === 0) continue;
      if (!site) {
        site = {
          key: k,
          server: "caddy",
          names: hosts,
          listens: listens.map((l) => ({ ...l, https: https && l.port !== 80 })),
          https,
          isDefault: hosts.length === 0,
          cert: null,
          certExpires: null,
          routes: [],
          file: configPath,
          line: null,
        };
        byHost.set(k, site);
        order.push(site);
      }
      site.routes.push(...routes);
    }
  }
  const logs = detectCaddyAccessLogs(cfg, order);
  for (const s of order) s.accessLog = logs.get(s.key) ?? null;
  return order;
}
