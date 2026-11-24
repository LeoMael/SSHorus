// Enlaces entre nodos del mapa: resolución de upstreams web y conexiones establecidas entre servidores.
import { resolveOwner, sortOwners } from "./owner";
import {
  isLocalHost,
  ownerContext,
  type EdgeKind,
  type Listener,
  type MapNode,
  type MapServer,
  type PendingUpstream,
  type ServerSnapshot,
} from "./graphTypes";

export interface LinkCtx {
  snaps: ServerSnapshot[];
  servers: MapServer[];
  nodes: Map<string, MapNode>;
  byPort: Map<string, Map<number, Listener>>;
  allListeners: Map<string, Listener[]>;
  add: (n: MapNode) => MapNode;
  edge: (from: string, to: string, label: string, kind: EdgeKind) => void;
}

export function resolveUpstreamsAndCross(ctx: LinkCtx, pendingUpstreams: PendingUpstream[]): void {
  const { snaps, servers, nodes, byPort, allListeners, add, edge } = ctx;
  const findServer = (host: string | null, from: string): ServerSnapshot | null => {
    if (!host || isLocalHost(host)) return null;
    const h = host.toLowerCase();
    return snaps.find((x) => x.id !== from && (x.host.toLowerCase() === h || x.name.toLowerCase() === h || x.extra?.hostname?.toLowerCase() === h || x.extra?.addrs.includes(host))) ?? null;
  };

  for (const u of pendingUpstreams) {
    const snap = snaps.find((x) => x.id === u.sid)!;
    const self = isLocalHost(u.host) || snap.extra?.addrs.includes(u.host ?? "") || snap.extra?.hostname === u.host;
    let target: MapNode | null = null;
    let kind: EdgeKind = "proxy";
    if (u.socket) {
      target = add({
        id: `${u.sid}|sock:${u.socket}`,
        server: u.sid,
        owner: u.owner,
        kind: "process",
        layer: 5,
        label: u.socket.split("/").pop() ?? u.socket,
        sub: "socket unix",
        health: "ok",
        group: null,
        localOnly: true,
        details: [["Socket", u.socket]],
        nav: null,
      });
    } else if (self && u.port !== null) {
      target = byPort.get(u.sid)?.get(u.port)?.node ?? null;
    } else if (u.host && u.port !== null) {
      const ctr = snap.containers.find((c) => c.name === u.host || c.composeService === u.host);
      const other = findServer(u.host, u.sid);
      if (ctr) target = nodes.get(`${u.sid}|ctr:${ctr.user}:${ctr.name}`) ?? null;
      else if (other) {
        target = byPort.get(other.id)?.get(u.port)?.node ?? null;
        kind = "cross";
      }
    }
    if (!target) {
      const host = u.host ?? "localhost";
      target = add({
        id: `${u.sid}|ext:${host}:${u.port ?? ""}`,
        server: u.sid,
        owner: u.owner,
        kind: "external",
        layer: 6,
        label: `${host}${u.port ? `:${u.port}` : ""}`,
        sub: self ? "nada escucha aquí" : "destino externo",
        health: self ? "bad" : "ok",
        group: null,
        localOnly: true,
        details: [["Destino", u.url]],
        nav: null,
      });
    }
    edge(u.from, target.id, u.label, kind);
  }

  for (const s of snaps) {
    const mine = byPort.get(s.id)!;
    for (const c of s.extra?.established ?? []) {
      if (mine.has(c.localPort)) continue;
      const other = snaps.find((x) => x.id !== s.id && (x.extra?.addrs.includes(c.peerIp) || x.host === c.peerIp));
      if (!other) continue;
      const target = byPort.get(other.id)?.get(c.peerPort)?.node;
      if (!target) continue;
      const ls = allListeners.get(s.id)!;
      const src = (c.pid !== null ? ls.find((l) => l.pids.has(c.pid!)) : undefined) ?? (c.proc ? ls.find((l) => l.procName === c.proc) : undefined);
      let node = src?.node;
      if (!node) {
        const user = c.pid !== null ? (s.extra?.procUsers?.get(c.pid) ?? null) : null;
        const owner = resolveOwner({ kind: "account", user }, ownerContext(s));
        node = add({
          id: `${s.id}|cli:${owner}:${c.proc ?? "?"}`,
          server: s.id,
          owner,
          kind: "process",
          layer: 5,
          label: c.proc ?? "conexión saliente",
          sub: "cliente",
          health: "ok",
          group: null,
          localOnly: true,
          details: [["Proceso", c.proc ?? "? (con sudo se ve cuál)"]],
          nav: null,
        });
        const srv = servers.find((x) => x.id === s.id)!;
        if (!srv.owners.includes(owner)) srv.owners = sortOwners([...srv.owners, owner], s.me);
      }
      edge(node.id, target.id, `:${c.peerPort}`, "cross");
    }
  }
}
