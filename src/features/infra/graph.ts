// Mapa de infraestructura: de lo leído en cada servidor (puertos, sitios web, contenedores, conexiones)
// a un grafo de nodos y aristas. Tipos y filtros en graphTypes.ts; upstreams/enlaces en graphLinks.ts.
import { WELL_KNOWN } from "../admin/ports";
import { resolveOwner, sortOwners, SYSTEM_OWNER, webServerOwner } from "./owner";
import { resolveUpstreamsAndCross } from "./graphLinks";
import {
  classify,
  containerFor,
  DB_RE,
  healthOfContainer,
  ownerContext,
  PLUMBING_RE,
  portText,
  PROXY_IMG_RE,
  siteNode,
  type EdgeKind,
  type Health,
  type InfraGraph,
  type Listener,
  type MapEdge,
  type MapNode,
  type MapServer,
  type OwnedContainer,
  type PendingUpstream,
  type ServerSnapshot,
} from "./graphTypes";

export * from "./graphTypes";

/** Construye el grafo de uno o varios servidores (los de un proyecto en un mismo lienzo). */
export function buildGraph(snaps: ServerSnapshot[], now = Date.now()): InfraGraph {
  const nodes = new Map<string, MapNode>();
  const edges = new Map<string, MapEdge>();
  const servers: MapServer[] = [];
  const pendingUpstreams: PendingUpstream[] = [];
  const add = (n: MapNode) => {
    const ex = nodes.get(n.id);
    if (ex) return ex;
    nodes.set(n.id, n);
    return n;
  };
  const edge = (from: string, to: string, label: string, kind: EdgeKind) => {
    if (from === to) return;
    const id = `${from}>${to}>${label}`;
    if (!edges.has(id)) edges.set(id, { id, from, to, label, kind });
  };
  const internet: MapNode = {
    id: "internet",
    server: null,
    owner: null,
    kind: "internet",
    layer: 0,
    label: "Internet",
    sub: "",
    health: "ok",
    group: null,
    localOnly: false,
    details: [],
    nav: null,
  };

  const byPort = new Map<string, Map<number, Listener>>();
  const allListeners = new Map<string, Listener[]>();

  for (const s of snaps) {
    const sid = s.id;
    const srv: MapServer = {
      id: sid,
      name: s.name,
      os: s.extra?.os ?? null,
      host: s.host,
      health: s.offline ? "off" : s.error ? "bad" : "ok",
      owners: [],
      elevated: s.elevated,
      notes: [...s.notes],
      firewall: null,
    };
    servers.push(srv);
    const owners = new Set<string>();
    const listeners: Listener[] = [];
    const portMap = new Map<number, Listener>();
    byPort.set(sid, portMap);
    allListeners.set(sid, listeners);
    const nid = (x: string) => `${sid}|${x}`;
    const ctx = ownerContext(s);
    const ownerOfUser = (user: string | null) => resolveOwner({ kind: "account", user }, ctx);

    const fw = s.extra?.firewall.find((f) => f.active) ?? null;
    if (s.extra?.firewall.length) srv.firewall = s.extra.firewall.map((f) => `${f.tool} ${f.state}`).join(" · ");
    let entry = internet.id;
    if (fw) {
      const n = add({
        id: nid("fw"),
        server: sid,
        owner: SYSTEM_OWNER,
        kind: "firewall",
        layer: 1,
        label: fw.tool,
        sub: fw.state,
        health: "ok",
        group: null,
        localOnly: false,
        details: [["Cortafuegos", fw.tool], ["Estado", fw.state]],
        nav: null,
      });
      edge(internet.id, n.id, "", "net");
      entry = n.id;
    }

    const ctrNode = new Map<OwnedContainer, MapNode>();
    for (const c of s.containers) {
      const db = DB_RE.test(c.image) || DB_RE.test(c.name);
      const proxy = PROXY_IMG_RE.test(c.image);
      const pubs = c.ports.filter((m) => m.hostPort !== null).map((m) => `${m.hostIp ? `${m.hostIp}:` : ""}${m.hostPort}→${m.containerPort}/${m.protocol}`);
      const owner = ownerOfUser(c.user);
      const n = add({
        id: nid(`ctr:${c.user}:${c.name}`),
        server: sid,
        owner,
        kind: db ? "db" : "container",
        layer: db ? 6 : proxy ? 3 : 5,
        label: c.name,
        sub: c.image.replace(/^(docker\.io|quay\.io|ghcr\.io)\//, "").replace(/^library\//, ""),
        health: healthOfContainer(c),
        group: c.pod ?? c.composeProject,
        localOnly: true,
        details: [
          ["Contenedor", `${c.name} (${c.engine})`],
          ["Imagen", c.image],
          ["Estado", c.status || c.state],
          ...(pubs.length ? [["Puertos", pubs.join(", ")] as [string, string]] : []),
          ...(c.networks.length ? [["Red", c.networks.join(", ")] as [string, string]] : []),
          ...(c.composeProject ? [["Compose", `${c.composeProject}${c.composeService ? ` · ${c.composeService}` : ""}`] as [string, string]] : []),
          ...(c.pod ? [["Pod", c.pod] as [string, string]] : []),
          ["Usuario", c.user],
        ],
        nav: { kind: "containers", name: c.name },
      });
      if (db) n.kind = "db";
      ctrNode.set(c, n);
      owners.add(owner);
    }

    const seen = new Set<string>();
    for (const p of s.ports?.ports ?? []) {
      const owner = ownerOfUser(p.user);
      const proc = p.procs[0]?.name ?? null;
      const ctr = containerFor(p, s.containers);
      let n: MapNode;
      if (ctr && (!proc || PLUMBING_RE.test(proc) || p.container)) {
        n = ctrNode.get(ctr)!;
      } else if (p.unit) {
        const userUnit = p.userUnit || (!!p.user && !!s.userServices[p.user]?.includes(p.unit));
        const unitOwner = resolveOwner({ kind: "unit", scope: userUnit ? "user" : "system", user: p.user }, ctx);
        const name = proc ?? p.unit.replace(/\.service$/, "");
        const kind = classify(name, p.port);
        n = add({
          id: nid(`svc:${unitOwner}:${p.unit}`),
          server: sid,
          owner: unitOwner,
          kind: kind === "process" ? "service" : kind,
          layer: kind === "proxy" ? 3 : kind === "db" ? 6 : 5,
          label: p.unit.replace(/\.service$/, ""),
          sub: proc && proc !== p.unit.replace(/\.service$/, "") ? proc : "systemd",
          health: "ok",
          group: null,
          localOnly: true,
          details: [["Servicio", p.unit], ...(proc ? [["Proceso", proc] as [string, string]] : []), ["Usuario", p.user ?? "?"]],
          nav: { kind: "ports", port: p.port },
        });
      } else {
        const name = proc ?? "";
        const kind = classify(name, p.port);
        const label = proc ?? WELL_KNOWN[p.port] ?? "¿?";
        n = add({
          id: nid(proc ? `proc:${owner}:${proc}` : `proc:?:${p.proto}:${p.port}`),
          server: sid,
          owner,
          kind,
          layer: kind === "proxy" ? 3 : kind === "db" ? 6 : 5,
          label,
          sub: proc ? "proceso" : "sin permiso para ver el proceso",
          health: proc ? "ok" : "warn",
          group: null,
          localOnly: true,
          details: [["Proceso", proc ?? "?"], ["Usuario", p.user ?? "?"]],
          nav: { kind: "ports", port: p.port },
        });
      }
      owners.add(n.owner ?? SYSTEM_OWNER);
      let l = listeners.find((x) => x.node === n);
      if (!l) {
        l = { node: n, pids: new Set(), procName: proc, ports: [] };
        listeners.push(l);
      }
      for (const pp of p.procs) l.pids.add(pp.pid);
      l.ports.push(p);
      if (p.proto === "tcp" && !portMap.has(p.port)) portMap.set(p.port, l);

      const exposed = p.scope !== "local";
      const key = `${p.proto}:${p.port}:${exposed ? "x" : "l"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!exposed) continue;
      n.localOnly = false;
      const service = WELL_KNOWN[p.port];
      const pn = add({
        id: nid(`port:${p.proto}:${p.port}`),
        server: sid,
        owner: n.owner,
        kind: "port",
        layer: 2,
        label: portText(p),
        sub: service ?? p.proto.toUpperCase(),
        health: "ok",
        group: null,
        localOnly: false,
        details: [["Puerto", `${p.port}/${p.proto}`], ["Escucha en", p.ip === "*" ? "todas" : p.ip], ...(service ? [["Servicio", service] as [string, string]] : [])],
        nav: { kind: "ports", port: p.port },
      });
      edge(entry, pn.id, "", "net");
      const m = n.kind === "container" || n.kind === "db" ? ctr?.ports.find((x) => x.hostPort === p.port) : null;
      edge(pn.id, n.id, m ? `→${m.containerPort}` : "", m ? "publish" : "net");
    }
    for (const l of listeners) {
      const list = [...new Set(l.ports.map((p) => `${p.scope === "local" ? "local " : ""}${portText(p)}`))];
      l.node.details.push(["Escucha", list.join(", ")]);
      if (l.node.sub === "proceso" || l.node.sub === "systemd") l.node.sub = list.slice(0, 3).join(" ");
    }

    for (const [user, units] of Object.entries(s.userServices)) {
      const owner = resolveOwner({ kind: "unit", scope: "user", user }, ctx);
      for (const u of units) {
        const id = nid(`svc:${owner}:${u}`);
        if (nodes.has(id)) continue;
        add({
          id,
          server: sid,
          owner,
          kind: "service",
          layer: 5,
          label: u.replace(/\.service$/, ""),
          sub: "systemctl --user",
          health: "ok",
          group: null,
          localOnly: true,
          details: [["Servicio de usuario", u], ["Usuario", user]],
          nav: null,
        });
        owners.add(owner);
      }
    }

    for (const w of s.web?.servers ?? []) {
      const declared = webServerOwner({ status: w.status, configOwner: s.configOwners?.[w.configPath] ?? null }, ctx);
      const l = listeners.find((x) => x.procName && x.procName.toLowerCase().startsWith(w.server) && (declared === null || x.node.owner === declared));
      const health: Health = w.status === "failed" ? "bad" : w.status === "inactive" ? "off" : w.warning ? "warn" : "ok";
      let pn: MapNode;
      if (l) {
        pn = l.node;
        pn.kind = "proxy";
        pn.layer = 3;
        pn.health = health;
      } else {
        pn = add({
          id: nid(`proxy:${w.server}`),
          server: sid,
          owner: declared ?? ownerOfUser(null),
          kind: "proxy",
          layer: 3,
          label: w.server,
          sub: w.status ?? "",
          health,
          group: null,
          localOnly: true,
          details: [],
          nav: { kind: "web" },
        });
        owners.add(pn.owner!);
        for (const port of new Set(w.sites.flatMap((x) => x.listens.map((li) => li.port)))) {
          const pnode = nodes.get(nid(`port:tcp:${port}`));
          if (pnode && portMap.get(port)?.node.id === nid(`proc:?:tcp:${port}`)) edge(pnode.id, pn.id, "", "net");
        }
      }
      pn.details.push(["Proxy web", `${w.server}${w.status ? ` (${w.status})` : ""}`], ["Configuración", w.configPath]);
      pn.nav = { kind: "web" };
      for (const site of w.sites) {
        const sn = siteNode(site, sid, pn.owner ?? SYSTEM_OWNER, now);
        add(sn);
        edge(pn.id, sn.id, "", "proxy");
        for (const r of site.routes) {
          const t = r.target;
          if (t.kind !== "proxy" && t.kind !== "fastcgi") continue;
          const socket = t.kind === "proxy" ? t.socket : null;
          const label = `${r.path !== "/" ? `${r.path} ` : ""}${t.port ? `:${t.port}` : socket ? "unix" : ""}`.trim();
          pendingUpstreams.push({ sid, from: sn.id, host: t.host, port: t.port, socket, label, owner: pn.owner ?? SYSTEM_OWNER, url: t.kind === "proxy" ? t.url : t.addr });
        }
      }
    }
    srv.owners = sortOwners([...owners], s.me);
  }

  resolveUpstreamsAndCross({ snaps, servers, nodes, byPort, allListeners, add, edge }, pendingUpstreams);

  for (const srv of servers) {
    if (srv.health !== "ok") continue;
    if ([...nodes.values()].some((n) => n.server === srv.id && n.health === "bad")) srv.health = "warn";
  }

  const list = [...nodes.values()];
  if (list.length > 0 || servers.length > 0) list.unshift(internet);
  const es = [...edges.values()];
  const out = es.some((e) => e.from === internet.id) ? list : list.filter((n) => n !== internet);
  return { servers, nodes: out, edges: es };
}
