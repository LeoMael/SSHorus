// Parseo de `inspect <contenedor>` y división de salidas marcadas `@@tv:<sección>`.
import type { InspectSummary } from "./types";
import { isObj, num, parseLabels, str } from "./parsePrimitives";

/** Resumen legible de `inspect <contenedor>` (igual para Podman y Docker). */
export function parseInspect(text: string): { summary: InspectSummary | null; raw: unknown } {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    return { summary: null, raw: null };
  }
  const o = Array.isArray(raw) ? raw[0] : raw;
  if (!isObj(o)) return { summary: null, raw };
  const cfg = isObj(o.Config) ? o.Config : {};
  const host = isObj(o.HostConfig) ? o.HostConfig : {};
  const st = isObj(o.State) ? o.State : {};
  const ns = isObj(o.NetworkSettings) ? o.NetworkSettings : {};
  const rp = isObj(host.RestartPolicy) ? host.RestartPolicy : {};

  const env = (Array.isArray(cfg.Env) ? cfg.Env : []).map(str).map((e) => {
    const i = e.indexOf("=");
    return i < 0 ? { key: e, value: "" } : { key: e.slice(0, i), value: e.slice(i + 1) };
  });
  const mounts = (Array.isArray(o.Mounts) ? o.Mounts : []).filter(isObj).map((m) => ({
    type: str(m.Type),
    source: str(m.Source),
    destination: str(m.Destination),
    rw: m.RW !== false,
    name: str(m.Name),
  }));
  const networks: InspectSummary["networks"] = [];
  if (isObj(ns.Networks)) {
    for (const [name, n] of Object.entries(ns.Networks)) {
      if (!isObj(n)) continue;
      networks.push({ name, ip: str(n.IPAddress), gateway: str(n.Gateway), mac: str(n.MacAddress) });
    }
  }
  if (networks.length === 0 && str(ns.IPAddress)) {
    networks.push({ name: str(host.NetworkMode) || "—", ip: str(ns.IPAddress), gateway: str(ns.Gateway), mac: str(ns.MacAddress) });
  }
  const ports: InspectSummary["ports"] = [];
  if (isObj(ns.Ports)) {
    for (const [cport, binds] of Object.entries(ns.Ports)) {
      if (Array.isArray(binds) && binds.length) {
        for (const b of binds) {
          if (!isObj(b)) continue;
          const ip = str(b.HostIp);
          ports.push({ container: cport, host: `${ip && ip !== "0.0.0.0" ? ip : "*"}:${str(b.HostPort)}` });
        }
      } else ports.push({ container: cport, host: "" });
    }
  }
  const cmdParts = [
    ...(Array.isArray(cfg.Entrypoint) ? cfg.Entrypoint.map(str) : typeof cfg.Entrypoint === "string" ? [cfg.Entrypoint] : []),
    ...(Array.isArray(cfg.Cmd) ? cfg.Cmd.map(str) : typeof cfg.Cmd === "string" ? [cfg.Cmd] : []),
  ];
  const maxRetry = num(rp.MaximumRetryCount);
  const rpName = str(rp.Name);
  return {
    raw,
    summary: {
      id: str(o.Id),
      name: str(o.Name).replace(/^\//, ""),
      image: str(o.ImageName) || str(cfg.Image) || str(o.Image),
      created: str(o.Created),
      state: str(st.Status),
      startedAt: str(st.StartedAt),
      restartPolicy: rpName === "on-failure" && maxRetry ? `${rpName}:${maxRetry}` : rpName,
      restartCount: num(o.RestartCount),
      command: cmdParts.join(" "),
      workingDir: str(cfg.WorkingDir),
      env,
      mounts,
      networks,
      ports,
      labels: parseLabels(cfg.Labels),
    },
  };
}

/** Divide la salida en secciones marcadas con líneas `@@tv:<nombre>`. */
export function splitMarked(stdout: string): Map<string, string> {
  const out = new Map<string, string>();
  let cur: string | null = null;
  let buf: string[] = [];
  for (const line of stdout.split("\n")) {
    const m = /^@@tv:([a-z0-9_-]+)\s*$/.exec(line);
    if (m) {
      if (cur !== null) out.set(cur, buf.join("\n"));
      cur = m[1];
      buf = [];
    } else if (cur !== null) buf.push(line);
  }
  if (cur !== null) out.set(cur, buf.join("\n"));
  return out;
}
