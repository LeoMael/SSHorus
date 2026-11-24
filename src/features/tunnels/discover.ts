// Lectura del servidor para «Servicios que puedes traer»: puertos en escucha (como root si hay sudo, para
// ver el programa de cada uno) y puertos publicados de los contenedores. Solo lectura: no se cambia nada.
import { PORTS_SCRIPT, parsePorts } from "../admin/ports";
import { refreshPrivilege, type Elevation, readElevated, runScript } from "../privileges";
import { tunnels, type TunnelDef } from "../../api/tunnels";
import { CONTAINER_PORTS_SCRIPT, findServices, parseContainerPublish, wantedLocalPort, type FoundService } from "./detect";
import { applyHttpProbe, httpProbeScript, parseHttpProbe } from "./probe";

export interface Discovery {
  services: FoundService[];
  /** Se leyó como root: se ve el programa de todos los puertos. */
  elevated: boolean;
}

/** `sshPort`: el de esta conexión (no se ofrece traer el propio SSH). */
export async function discoverServices(sessionId: string, elevation: Elevation | null, sshPort: number): Promise<Discovery> {
  const [ports, ctr] = await Promise.all([
    readElevated(sessionId, PORTS_SCRIPT, elevation, 20),
    // Los contenedores son un extra: si falla, se sigue con lo que diga `ss`.
    runScript(sessionId, CONTAINER_PORTS_SCRIPT, { kind: "none" }, "", 15).catch(() => null),
  ]);
  if (ports.elevationError?.failure === "need-password") refreshPrivilege(sessionId);
  const published = ctr ? parseContainerPublish(ctr.stdout) : [];
  const services = findServices(parsePorts(ports.result.stdout).ports, published, sshPort);
  return { services: await guessWeb(sessionId, services), elevated: ports.elevated };
}

/** Los no reconocidos que responden por HTTP pasan a «Web / panel». Es un extra: si falla, quedan igual. */
async function guessWeb(sessionId: string, services: FoundService[]): Promise<FoundService[]> {
  const script = httpProbeScript(services);
  if (!script) return services;
  const r = await runScript(sessionId, script, { kind: "none" }, "", 10).catch(() => null);
  return r ? applyHttpProbe(services, parseHttpProbe(r.stdout)) : services;
}

/**
 * Puerto en tu PC para cada servicio: el del túnel que ya tengas hacia él o, si no, el mismo del servidor
 * si está libre en tu PC (si no, el siguiente libre). 0 = lo elegirá el sistema al activarlo.
 */
export async function proposeLocalPorts(
  services: FoundService[],
  defs: TunnelDef[],
  existing: (s: FoundService) => TunnelDef | undefined,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const pending = services.filter((s) => {
    const def = existing(s);
    if (def) out[s.key] = def.bindPort;
    return !def;
  });
  if (pending.length === 0) return out;
  const avoid = defs.filter((d) => d.kind !== "remote" && d.bindPort > 0).map((d) => d.bindPort);
  const free = await tunnels.suggestLocalPorts(
    pending.map((s) => wantedLocalPort(s.port)),
    avoid,
  );
  pending.forEach((s, i) => (out[s.key] = free[i] ?? 0));
  return out;
}
