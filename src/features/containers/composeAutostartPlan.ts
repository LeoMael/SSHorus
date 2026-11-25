// Plan para que un proyecto de podman-compose arranque solo: con su servicio podman-compose@<proyecto>
// o, si no se puede (o se prefiere), con la política de reinicio de cada contenedor + podman-restart.service
// (el mismo plan que un contenedor suelto). Funciones puras.
import { decideAutostart, type OwnerAutostart } from "./autostart";
import { autostartPlan, type AutostartPlan, type AutostartTarget, type PlanCtx } from "./autostartPlan";
import {
  composeServiceCmds,
  composeUnitProject,
  decideComposeAutostart,
  type ComposeChoice,
  type ComposeDecision,
  type ComposeTarget,
} from "./composeAutostart";
import type { Container } from "./types";

export interface ComposeGroup extends ComposeTarget {
  owner: string;
  unit: string;
  targets: AutostartTarget[];
  containers: Container[];
}

/** Agrupa por dueño y proyecto los contenedores cuyo servicio podman-compose@ hay que preparar. */
export function composeGroups(targets: AutostartTarget[], containers: Container[]): ComposeGroup[] {
  const map = new Map<string, ComposeGroup>();
  for (const t of targets) {
    const project = composeUnitProject(t.info.unit);
    if (!project || !t.info.missing.includes("compose") || !t.info.unit) continue;
    const c = containers.find((x) => x.id === t.id && (x.owner ?? "") === t.owner);
    const k = `${t.owner}|${project}`;
    let g = map.get(k);
    if (!g) {
      g = { owner: t.owner, project, unit: t.info.unit, dir: null, files: [], inPod: true, targets: [], containers: [] };
      map.set(k, g);
    }
    g.targets.push(t);
    if (c) {
      g.containers.push(c);
      g.dir ??= c.composeWorkingDir || null;
      if (!g.files.length && c.composeConfigFiles) g.files = c.composeConfigFiles.split(",").map((f) => f.trim()).filter(Boolean);
      if (!c.pod) g.inPod = false;
    }
  }
  return [...map.values()];
}

/** Datos del dueño como si sus contenedores no tuvieran unidad: para el plan de la política de reinicio. */
function withoutUnits(f: OwnerAutostart): OwnerAutostart {
  return { ...f, policies: new Map([...f.policies].map(([id, p]) => [id, { ...p, unit: null }])) };
}

export interface ComposePlan extends AutostartPlan {
  decision: ComposeDecision;
  choice: ComposeChoice;
}

/** Plan de `choice` (o del recomendado) para un proyecto. null si faltan los datos del dueño. */
export function composeAutostartPlan(g: ComposeGroup, ctx: PlanCtx, choice?: ComposeChoice): ComposePlan | null {
  const f = ctx.facts(g.owner);
  const o = ctx.owner(g.owner);
  if (!f?.compose || !o) return null;
  const decision = decideComposeAutostart(g, f.compose, f.linger);
  const pick: ComposeChoice = choice === "service" && !decision.serviceOk ? "restart" : (choice ?? decision.choice);
  if (pick === "service") {
    return { decision, choice: pick, cmds: composeServiceCmds(g, decision.steps, { owner: g.owner, linger: o.linger }), notes: [] };
  }
  const plain = withoutUnits(f);
  const targets = g.targets.flatMap((t) => {
    const info = decideAutostart(t.id, plain, o.scope, ctx.version);
    return info && info.verdict !== "yes" ? [{ ...t, info }] : [];
  });
  const plan = autostartPlan(true, targets, { ...ctx, facts: (k) => (k === g.owner ? plain : ctx.facts(k)) });
  return { decision, choice: pick, ...plan };
}
