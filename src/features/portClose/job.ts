// «Cerrar puerto»: leer lo necesario (cortafuegos y contenedores de todos los dueños) y aplicar la forma
// elegida como tarea en segundo plano. El cortafuegos va por su propia tarea a prueba (vuelta atrás
// programada y prueba de una conexión SSH nueva); parar un servicio, programa o contenedor, por esta.
import type { PortsResult } from "../admin/ports";
import { sshListenPorts } from "../audit/fixSafety";
import { readAllContainers, type FoundContainer } from "../containers/readAll";
import { ownerWrap } from "../containers/ownerRun";
import { scriptFor } from "../containers/run";
import { sshGuard, type SshGuard } from "../infra/firewall/lockout";
import { readFirewall } from "../infra/firewall/read";
import { startFirewallChange } from "../infra/firewall/job";
import type { FwReport } from "../infra/firewall/types";
import { runElevated, startJob } from "../jobs";
import { failureText, succeeded, type Elevation } from "../privileges";
import { errorMessage } from "../../api/core";
import type { CloseAction, CloseStep } from "./types";

export const PORT_CLOSE_JOB = "port-close";

const NONE: Elevation = { kind: "none" };

export interface CloseContext {
  firewall: FwReport | null;
  firewallError: string | null;
  guard: SshGuard;
  containers: FoundContainer[];
}

export interface ReadOpts {
  /** null = sin sudo (solo se ve lo tuyo). */
  elevation: Elevation | null;
  profilePort: number;
  ports: PortsResult | null;
  me: string | null;
  isRoot: boolean;
}

export async function readCloseContext(sessionId: string, o: ReadOpts): Promise<CloseContext> {
  const notes: string[] = [];
  const [fw, containers] = await Promise.all([
    readFirewall(sessionId, o.elevation, o.profilePort, o.ports).then(
      (r) => ({ r, error: r.sudoError }),
      (e) => ({ r: null, error: errorMessage(e) }),
    ),
    readAllContainers(sessionId, o.isRoot ? NONE : o.elevation, o.me, o.isRoot, notes).catch(() => []),
  ]);
  const guard = fw.r?.guard ?? sshGuard(null, o.profilePort, sshListenPorts(o.ports, o.profilePort));
  return { firewall: fw.r?.report ?? null, firewallError: fw.error, guard, containers };
}

/** Hace falta sudo para algún paso. */
export function needsElevation(a: CloseAction): boolean {
  if (a.kind === "firewall") return true;
  if (a.kind !== "run") return false;
  return a.steps.some((s) => (s.kind === "shell" ? s.root : s.ctr.sudo));
}

async function stepScript(s: CloseStep): Promise<string> {
  return s.kind === "shell" ? `PATH=$PATH:/usr/sbin:/sbin\n${s.script}` : ownerWrap(s.ctr.engine, s.ctr.ctOwner, scriptFor([s.cmd]));
}

export interface CloseRequest {
  sessionId: string;
  profileId: string;
  serverName: string;
  /** Elevación disponible (null = sin sudo: solo pasos sin root). */
  elevation: Elevation | null;
  title: string;
  action: Extract<CloseAction, { kind: "firewall" | "run" }>;
}

/** Empieza la tarea y devuelve su id (null si falta sudo). */
export function startClose(req: CloseRequest): string | null {
  const a = req.action;
  if (needsElevation(a) && !req.elevation) return null;
  if (a.kind === "firewall") {
    return startFirewallChange({ sessionId: req.sessionId, profileId: req.profileId, serverName: req.serverName, elevation: req.elevation!, plan: a.plan });
  }
  return startJob({
    kind: PORT_CLOSE_JOB,
    sessionId: req.sessionId,
    server: req.serverName,
    title: req.title,
    detail: a.steps.map((s) => s.show).join(" · "),
    cancelLabel: null,
    run: async (ctx) => {
      for (const s of a.steps) {
        ctx.output(`$ ${s.show}\n`);
        const root = s.kind === "shell" ? s.root : s.ctr.sudo;
        const r = await runElevated(ctx, req.sessionId, await stepScript(s), root ? req.elevation! : NONE, 120);
        if (!succeeded(r)) return { status: "failed", error: failureText(r) };
      }
      return { summary: a.success };
    },
  });
}
