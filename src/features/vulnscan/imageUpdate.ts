// «Actualizar imagen» (escáner → hallazgo de una imagen de Podman o Docker): planificación de pasos.
// La lectura (`inspect`) está en imageUpdateRead.ts y el formulario/reemplazo en imageUpdateForm.ts.
import type { Engine } from "../../api/vulnscan";
import { composeCmd, composeFor, pullImage } from "../containers/commands";
import { OBJ_NAME_RE, renderCmd, type Cmd } from "../containers/shell";
import type { ComposeTool } from "../containers/types";
import { SAFE } from "./fixCommand";
import type { ContainerDetail, ReadResult } from "./imageUpdateRead";

export * from "./imageUpdateRead";
export * from "./imageUpdateForm";

export type Group =
  | { kind: "compose"; project: string; dir: string; files: string[]; services: string[]; tool: ComposeTool; containers: string[] }
  | { kind: "systemd"; unit: string; user: boolean; containers: string[] }
  /** `ref`: imagen con la que se vuelve a crear. */
  | { kind: "run"; container: ContainerDetail; ref: string }
  | { kind: "manual"; containers: string[]; reason: string };

export interface Step {
  label: string;
  cmds: Cmd[];
}

export interface UpdatePlan {
  engine: Engine;
  tag: string;
  groups: Group[];
  steps: Step[];
  recreated: string[];
  notes: string[];
}

const PROJECT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const UNIT_RE = /^[A-Za-z0-9][A-Za-z0-9@._:-]*\.service$/;

function okPath(p: string): boolean {
  return p.startsWith("/") && !/[\n\r\0]/.test(p);
}

/** Herramienta de Compose para estos contenedores (null = no hay una que sirva). */
export function composeToolFor(engine: Engine, labels: Record<string, string>, tools: ComposeTool[]): ComposeTool | null {
  if (engine === "podman") {
    if (labels["io.podman.compose.project"]) return tools.includes("podman-compose") ? "podman-compose" : null;
    return tools.includes("podman compose") ? "podman compose" : null;
  }
  return composeFor("docker", tools);
}

interface ComposeInfo {
  project: string;
  dir: string;
  files: string[];
  service: string;
}

function composeInfo(c: ContainerDetail): ComposeInfo | null {
  const l = c.labels;
  const project = l["com.docker.compose.project"] ?? l["io.podman.compose.project"] ?? "";
  if (!project) return null;
  const dir = l["com.docker.compose.project.working_dir"] ?? "";
  const files = (l["com.docker.compose.project.config_files"] ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  return { project, dir, files, service: l["com.docker.compose.service"] ?? "" };
}

function refFor(c: ContainerDetail, tags: string[], tag: string): string {
  const r = c.imageRef;
  const norm = (x: string) => x.replace(/^docker\.io\/(library\/)?/, "");
  const known = tags.some((t) => t === r || norm(t) === norm(r) || norm(t) === `${norm(r)}:latest`);
  return r && known && SAFE.test(r) && !r.startsWith("localhost/") ? r : tag;
}

export interface PlanInput {
  engine: Engine;
  tag: string;
  tags: string[];
  read: ReadResult;
  ownerIsRoot: boolean;
}

/** Decide qué hacer con cada contenedor y arma los pasos automáticos. */
export function planUpdate(i: PlanInput): UpdatePlan {
  const { engine, tag, read } = i;
  const groups: Group[] = [];
  const compose = new Map<string, Extract<Group, { kind: "compose" }>>();
  const units = new Map<string, Extract<Group, { kind: "systemd" }>>();
  const manual = new Map<string, Extract<Group, { kind: "manual" }>>();
  const addManual = (name: string, reason: string) => {
    const g = manual.get(reason) ?? { kind: "manual" as const, containers: [], reason };
    g.containers.push(name);
    if (!manual.has(reason)) {
      manual.set(reason, g);
      groups.push(g);
    }
  };
  const pulls: string[] = [tag];

  for (const c of read.containers) {
    const ci = composeInfo(c);
    if (ci) {
      const tool = composeToolFor(engine, c.labels, read.composeTools);
      if (!ci.dir || !okPath(ci.dir) || !PROJECT_RE.test(ci.project) || ci.files.some((f) => /[\n\r\0]/.test(f))) {
        addManual(c.name, "Es de Compose pero no se sabe su carpeta: entra en ella y ejecuta «compose pull» y «compose up -d»");
        continue;
      }
      if (!tool) {
        addManual(
          c.name,
          c.labels["io.podman.compose.project"]
            ? "Se creó con podman-compose, que no está instalado para este usuario"
            : `No se encontró ${engine === "podman" ? "«podman compose»" : "Docker Compose"} en el servidor`,
        );
        continue;
      }
      const key = `${ci.project}\n${ci.dir}`;
      let g = compose.get(key);
      if (!g) {
        g = { kind: "compose", project: ci.project, dir: ci.dir, files: ci.files, services: [], tool, containers: [] };
        compose.set(key, g);
        groups.push(g);
      }
      g.containers.push(c.name);
      if (ci.service && OBJ_NAME_RE.test(ci.service) && !g.services.includes(ci.service)) g.services.push(ci.service);
      continue;
    }
    const unit = c.labels.PODMAN_SYSTEMD_UNIT ?? "";
    if (engine === "podman" && unit) {
      if (!UNIT_RE.test(unit)) {
        addManual(c.name, `Lo arranca systemd («${unit}»): reinicia esa unidad a mano`);
        continue;
      }
      let g = units.get(unit);
      if (!g) {
        g = { kind: "systemd", unit, user: !i.ownerIsRoot, containers: [] };
        units.set(unit, g);
        groups.push(g);
      }
      g.containers.push(c.name);
      const ref = refFor(c, i.tags, tag);
      if (!pulls.includes(ref)) pulls.push(ref);
      continue;
    }
    if (c.labels["com.docker.swarm.service.name"]) {
      addManual(c.name, "Es de un servicio de Docker Swarm: usa «docker service update --image»");
      continue;
    }
    if (c.pod) {
      addManual(c.name, "Está dentro de un pod: vuelve a crear el pod con el archivo con que lo creaste");
      continue;
    }
    if (!OBJ_NAME_RE.test(c.name)) {
      addManual(c.name, "Su nombre tiene caracteres raros: vuelve a crearlo a mano");
      continue;
    }
    const ref = refFor(c, i.tags, tag);
    groups.push({ kind: "run", container: c, ref });
    if (!pulls.includes(ref)) pulls.push(ref);
  }

  const steps: Step[] = pulls.map((r) => ({ label: `Descargar ${r}`, cmds: [pullImage(engine, r)] }));
  for (const g of groups) {
    if (g.kind === "compose") {
      const o = { project: g.project, services: g.services };
      steps.push({
        label: `Compose «${g.project}»: descargar y recrear (${g.containers.join(", ")})`,
        cmds: [composeCmd(g.tool, g.dir, g.files, "pull", o), composeCmd(g.tool, g.dir, g.files, "up", o)],
      });
    } else if (g.kind === "systemd") {
      steps.push({ label: `Reiniciar ${g.unit} (${g.containers.join(", ")})`, cmds: [systemctlRestart(g.unit, g.user)] });
    }
  }
  const recreated = groups.flatMap((g) => (g.kind === "compose" || g.kind === "systemd" ? g.containers : g.kind === "run" ? [g.container.name] : []));
  const notes: string[] = [];
  if (!read.containers.length) notes.push("Ningún contenedor la usa: solo se descarga la versión nueva. Quizá basta con borrarla.");
  return { engine, tag, groups, steps, recreated, notes };
}

export function systemctlRestart(unit: string, user: boolean): Cmd {
  return { bin: ["systemctl"], args: [...(user ? ["--user"] : []), "restart", unit] };
}

/** Script de un paso: se para en el primer comando que falle. */
export function stepScript(s: Step): string {
  return ["set -e", ...s.cmds.map(renderCmd)].join("\n");
}
