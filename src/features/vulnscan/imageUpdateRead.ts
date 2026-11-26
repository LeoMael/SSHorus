// Lectura (`inspect`) y resolución de dueño para «Actualizar imagen» en el escáner.
import type { Engine, Target } from "../../api/vulnscan";
import { parseJsonList } from "../containers/parsePrimitives";
import { splitMarked } from "../containers/parseInspect";
import type { ComposeTool } from "../containers";
import { updatableTag } from "./fixCommand";

/** Con quién se ejecuta: el usuario conectado, root (elevando) u otro usuario (elevando y entrando como él). */
export type Owner = { kind: "self" } | { kind: "root" } | { kind: "user"; name: string };

export function ownerOf(t: Target, me: string | null, connectedAsRoot: boolean): Owner {
  const u = t.user;
  if (!u || u === me) return { kind: "self" };
  if (u === "root") return connectedAsRoot ? { kind: "self" } : { kind: "root" };
  return { kind: "user", name: u };
}

export function ownerIsRoot(o: Owner, connectedAsRoot: boolean): boolean {
  return o.kind === "root" || (o.kind === "self" && connectedAsRoot);
}

export function ownerLabel(o: Owner, me: string | null): string {
  if (o.kind === "root") return "root";
  if (o.kind === "user") return o.name;
  return me ?? "tu usuario";
}

/** Se puede actualizar: imagen con etiqueta descargable y motor conocido. */
export function canUpdateImage(t: Target | undefined): boolean {
  return t?.kind === "image" && !!t.image?.engine && !!updatableTag(t) && /^[0-9a-f]{12,64}$/.test(t.image.id);
}

/** Script de lectura (como el dueño): herramientas Compose, `image inspect` e `inspect` de contenedores que usan la imagen. */
export function readScript(engine: Engine, imageId: string): string {
  const id = imageId.replace(/[^0-9a-f]/g, "");
  const e = engine;
  const compose =
    e === "podman"
      ? [
          'if podman compose version >/dev/null 2>&1; then echo "podman compose"; fi',
          "if command -v podman-compose >/dev/null 2>&1; then echo podman-compose; fi",
        ]
      : [
          'if docker compose version >/dev/null 2>&1; then echo "docker compose"; fi',
          "if command -v docker-compose >/dev/null 2>&1; then echo docker-compose; fi",
        ];
  return [
    "echo @@tv:compose",
    ...compose,
    "echo @@tv:image",
    `${e} image inspect ${id} 2>/dev/null`,
    "echo @@tv:containers",
    `ids=$(${e} ps -aq --no-trunc 2>/dev/null | xargs -r ${e} inspect --format '{{.Id}} {{.Image}}' 2>/dev/null | ` +
      `awk -v i=${id} 'index($2, i) == 1 || index($2, "sha256:" i) == 1 { print $1 }')`,
    `if [ -n "$ids" ]; then ${e} inspect $ids 2>/dev/null; fi`,
    "echo @@tv:end",
  ].join("\n");
}

/** Configuración de la imagen (para no copiar al formulario lo que ya trae la imagen). */
export interface ImageConfig {
  env: string[];
  cmd: string[];
  entrypoint: string[];
  user: string;
  workdir: string;
  labels: Record<string, string>;
}

export interface PortBinding {
  container: string;
  hostIp: string;
  hostPort: string;
}

export interface MountInfo {
  type: string;
  source: string;
  name: string;
  destination: string;
  rw: boolean;
}

/** Lo que hace falta de `inspect` de un contenedor. */
export interface ContainerDetail {
  id: string;
  name: string;
  imageId: string;
  imageRef: string;
  running: boolean;
  labels: Record<string, string>;
  pod: string;
  env: string[];
  cmd: string[];
  entrypoint: string[];
  user: string;
  workdir: string;
  ports: PortBinding[];
  mounts: MountInfo[];
  binds: string[];
  restart: string;
  restartRetries: number;
  networkMode: string;
  networks: string[];
  privileged: boolean;
  capAdd: string[];
  devices: number;
  memory: number;
  cpus: number;
  autoRemove: boolean;
  extraHosts: string[];
  dns: string[];
}

export interface ReadResult {
  complete: boolean;
  composeTools: ComposeTool[];
  image: ImageConfig | null;
  containers: ContainerDetail[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(str) : typeof v === "string" && v ? [v] : []);
function labelsOf(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(obj(v))) out[k] = str(val);
  return out;
}

function imageConfig(o: Obj): ImageConfig {
  const c = obj(o.Config);
  return { env: list(c.Env), cmd: list(c.Cmd), entrypoint: list(c.Entrypoint), user: str(c.User), workdir: str(c.WorkingDir), labels: labelsOf(c.Labels) };
}

function portBindings(o: Obj): PortBinding[] {
  const host = obj(o.HostConfig);
  let src = obj(host.PortBindings);
  if (!Object.keys(src).length) src = obj(obj(o.NetworkSettings).Ports);
  const out: PortBinding[] = [];
  for (const [cport, binds] of Object.entries(src)) {
    if (!Array.isArray(binds)) continue;
    for (const b of binds) if (isObj(b)) out.push({ container: cport, hostIp: str(b.HostIp), hostPort: str(b.HostPort) });
  }
  return out;
}

function containerDetail(o: Obj): ContainerDetail {
  const c = obj(o.Config);
  const h = obj(o.HostConfig);
  const st = obj(o.State);
  const rp = obj(h.RestartPolicy);
  return {
    id: str(o.Id),
    name: str(o.Name).replace(/^\//, ""),
    imageId: str(o.Image),
    imageRef: str(o.ImageName) || str(c.Image),
    running: st.Running === true,
    labels: labelsOf(c.Labels),
    pod: str(o.Pod),
    env: list(c.Env),
    cmd: list(c.Cmd),
    entrypoint: list(c.Entrypoint),
    user: str(c.User),
    workdir: str(c.WorkingDir),
    ports: portBindings(o),
    mounts: (Array.isArray(o.Mounts) ? o.Mounts : []).filter(isObj).map((m) => ({
      type: str(m.Type),
      source: str(m.Source),
      name: str(m.Name),
      destination: str(m.Destination),
      rw: m.RW !== false,
    })),
    binds: list(h.Binds),
    restart: str(rp.Name),
    restartRetries: num(rp.MaximumRetryCount),
    networkMode: str(h.NetworkMode),
    networks: Object.keys(obj(obj(o.NetworkSettings).Networks)),
    privileged: h.Privileged === true,
    capAdd: list(h.CapAdd),
    devices: Array.isArray(h.Devices) ? h.Devices.length : 0,
    memory: num(h.Memory),
    cpus: num(h.NanoCpus),
    autoRemove: h.AutoRemove === true,
    extraHosts: list(h.ExtraHosts),
    dns: list(h.Dns),
  };
}

const COMPOSE_TOOLS: ComposeTool[] = ["docker compose", "docker-compose", "podman compose", "podman-compose"];

/** Lee la salida de `readScript`. Solo deja los contenedores cuya imagen es `imageId`. */
export function parseRead(stdout: string, imageId: string): ReadResult {
  const s = splitMarked(stdout);
  const tools = (s.get("compose") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l): l is ComposeTool => (COMPOSE_TOOLS as string[]).includes(l));
  const img = parseJsonList(s.get("image") ?? "")[0];
  const id = imageId.replace(/^sha256:/, "");
  const containers = parseJsonList(s.get("containers") ?? "")
    .map(containerDetail)
    .filter((c) => c.name && c.imageId.replace(/^sha256:/, "").startsWith(id));
  return { complete: s.has("end"), composeTools: [...new Set(tools)], image: img ? imageConfig(img) : null, containers };
}
