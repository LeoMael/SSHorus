// Parseo de salidas JSON de Podman y Docker para contenedores, imágenes, volúmenes, redes, df y stats.
import type { Container, ContainerStats, DfRow, ImageInfo, NetworkInfo, VolumeInfo } from "./types";
import {
  healthOf,
  isObj,
  normalizeState,
  num,
  parseJsonList,
  parseLabels,
  parsePercent,
  parsePorts,
  parsePortsString,
  parseSize,
  parseTime,
  pick,
  str,
  strList,
  type Obj,
} from "./parsePrimitives";
import { parseInspect, splitMarked } from "./parseInspect";

export { normalizeState, parseInspect, parseJsonList, parseLabels, parsePortsString, parseSize, parseTime, splitMarked };

function exitCodeOf(o: Obj, status: string): number | null {
  const m = /exited \((-?\d+)\)/i.exec(status);
  if (m) return Number(m[1]);
  return num(pick(o, "ExitCode"));
}

/** `ps -a` de Podman (array) o Docker (una línea por contenedor). */
export function parseContainers(text: string): Container[] {
  const out: Container[] = [];
  for (const o of parseJsonList(text)) {
    const id = str(pick(o, "Id", "ID"));
    if (!id) continue;
    const names = strList(pick(o, "Names", "Name"));
    const status = str(pick(o, "Status"));
    const state = normalizeState(str(pick(o, "State")), status);
    const labels = parseLabels(pick(o, "Labels"));
    const cmdRaw = pick(o, "Command");
    const command = Array.isArray(cmdRaw) ? cmdRaw.map(str).join(" ") : str(cmdRaw).replace(/^"|"$/g, "");
    const created = parseTime(pick(o, "Created")) ?? parseTime(pick(o, "CreatedAt"));
    const pod = str(pick(o, "PodName")) || null;
    out.push({
      id,
      shortId: id.slice(0, 12),
      name: (names[0] ?? id.slice(0, 12)).replace(/^\//, ""),
      image: str(pick(o, "Image")),
      state,
      status,
      exitCode: state === "exited" ? exitCodeOf(o, status) : null,
      health: healthOf(status),
      created,
      ports: parsePorts(pick(o, "Ports")),
      labels,
      networks: strList(pick(o, "Networks")),
      command,
      composeProject: labels["com.docker.compose.project"] ?? labels["io.podman.compose.project"] ?? null,
      composeService: labels["com.docker.compose.service"] ?? null,
      composeWorkingDir: labels["com.docker.compose.project.working_dir"] ?? null,
      composeConfigFiles: labels["com.docker.compose.project.config_files"] ?? null,
      pod,
    });
  }
  return out;
}

/** `images` de Podman (array, una entrada por imagen con varias etiquetas) o Docker (una línea por etiqueta). */
export function parseImages(text: string): ImageInfo[] {
  const byId = new Map<string, ImageInfo>();
  const order: string[] = [];
  for (const o of parseJsonList(text)) {
    let id = str(pick(o, "Id", "ID")).replace(/^sha256:/, "");
    if (!id) continue;
    const repo = str(pick(o, "Repository"));
    const tag = str(pick(o, "Tag"));
    const names = strList(pick(o, "Names", "RepoTags"));
    let tags: string[];
    if (names.length) tags = names;
    else if (repo && repo !== "<none>") tags = [`${repo}:${tag && tag !== "<none>" ? tag : "latest"}`];
    else tags = [];
    tags = tags.filter((t) => !t.startsWith("<none>"));
    const containers = num(pick(o, "Containers"));
    const danglingRaw = pick(o, "Dangling");
    const dangling = typeof danglingRaw === "boolean" ? danglingRaw : tags.length === 0;
    id = id.toLowerCase();
    const prev = byId.get(id);
    if (prev) {
      for (const t of tags) if (!prev.tags.includes(t)) prev.tags.push(t);
      prev.dangling = prev.dangling && dangling;
      continue;
    }
    const first = tags[0] ?? "";
    const colon = first.lastIndexOf(":");
    const slash = first.lastIndexOf("/");
    const info: ImageInfo = {
      id,
      shortId: id.slice(0, 12),
      tags,
      repository: first ? (colon > slash ? first.slice(0, colon) : first) : repo || "<none>",
      tag: first ? (colon > slash ? first.slice(colon + 1) : "latest") : tag || "<none>",
      size: parseSize(pick(o, "Size")) ?? parseSize(pick(o, "VirtualSize")),
      created: parseTime(pick(o, "Created")) ?? parseTime(pick(o, "CreatedAt")),
      containers,
      dangling,
    };
    byId.set(id, info);
    order.push(id);
  }
  return order.map((id) => byId.get(id) as ImageInfo);
}

const HEX64 = /^[0-9a-f]{64}$/;

/** `volume ls` (todos) + lista de nombres sin usar (`volume ls -q --filter dangling=true`). */
export function parseVolumes(text: string, unusedNames: string[] = []): VolumeInfo[] {
  const unused = new Set(unusedNames.map((s) => s.trim()).filter(Boolean));
  const out: VolumeInfo[] = [];
  for (const o of parseJsonList(text)) {
    const name = str(pick(o, "Name"));
    if (!name) continue;
    const anon = pick(o, "Anonymous");
    out.push({
      name,
      driver: str(pick(o, "Driver")) || "local",
      mountpoint: str(pick(o, "Mountpoint")),
      created: parseTime(pick(o, "CreatedAt")),
      labels: parseLabels(pick(o, "Labels")),
      anonymous: typeof anon === "boolean" ? anon : HEX64.test(name),
      unused: unused.has(name),
    });
  }
  return out;
}

const BUILTIN_NETWORKS = new Set(["podman", "bridge", "host", "none"]);

export function parseNetworks(text: string): NetworkInfo[] {
  const out: NetworkInfo[] = [];
  for (const o of parseJsonList(text)) {
    const name = str(pick(o, "name", "Name"));
    if (!name) continue;
    const subnetsRaw = pick(o, "subnets", "Subnets");
    const subnets: string[] = [];
    if (Array.isArray(subnetsRaw)) {
      for (const s of subnetsRaw) if (isObj(s)) subnets.push(str(pick(s, "subnet", "Subnet")));
    }
    const internal = pick(o, "internal", "Internal");
    out.push({
      id: str(pick(o, "id", "ID", "Id")),
      name,
      driver: str(pick(o, "driver", "Driver")),
      subnets: subnets.filter(Boolean),
      internal: internal === true || internal === "true",
      created: parseTime(pick(o, "created", "CreatedAt", "Created")),
      labels: parseLabels(pick(o, "labels", "Labels")),
      builtin: BUILTIN_NETWORKS.has(name),
    });
  }
  return out;
}

const DF_LABELS: Record<string, string> = {
  images: "Imágenes",
  containers: "Contenedores",
  "local volumes": "Volúmenes",
  volumes: "Volúmenes",
  "build cache": "Caché de compilación",
};

/** `system df` (Podman: array con RawSize; Docker: una línea por tipo con tamaños en texto). */
export function parseDf(text: string): DfRow[] {
  return parseJsonList(text).map((o) => {
    const type = str(pick(o, "Type"));
    const reclaimText = str(pick(o, "Reclaimable"));
    return {
      type,
      label: DF_LABELS[type.toLowerCase()] ?? type,
      total: num(pick(o, "TotalCount", "Total")),
      active: num(pick(o, "Active")),
      size: num(pick(o, "RawSize")) ?? parseSize(pick(o, "Size")),
      reclaimable: num(pick(o, "RawReclaimable")) ?? parseSize(reclaimText),
      reclaimableText: reclaimText,
    };
  });
}

/** `stats --no-stream` (Podman json: textos "0.21%", "3.3MB / 16GB"; Podman {{json .}}: números; Docker: textos). */
export function parseStats(text: string): ContainerStats[] {
  const out: ContainerStats[] = [];
  for (const o of parseJsonList(text)) {
    const id = str(pick(o, "id", "ID", "ContainerID", "Container"));
    const name = str(pick(o, "name", "Name"));
    if (!id && !name) continue;
    let memUsage: number | null;
    let memLimit: number | null;
    const mu = pick(o, "mem_usage", "MemUsage");
    if (typeof mu === "string") {
      const [a, b] = mu.split("/");
      memUsage = parseSize(a);
      memLimit = parseSize(b);
    } else {
      memUsage = num(mu);
      memLimit = num(pick(o, "MemLimit"));
    }
    out.push({
      id,
      name,
      cpuPercent: parsePercent(pick(o, "cpu_percent", "CPUPerc", "CPU")),
      memUsage,
      memLimit,
      memPercent: parsePercent(pick(o, "mem_percent", "MemPerc")),
    });
  }
  return out;
}

/** Busca las estadísticas de un contenedor (por id corto/largo o nombre). */
export function statsFor(stats: ContainerStats[], c: { id: string; name: string; owner?: string }): ContainerStats | undefined {
  return stats.find(
    (s) => (s.owner ?? "") === (c.owner ?? "") && ((s.id && (c.id.startsWith(s.id) || s.id.startsWith(c.id))) || (s.name && s.name === c.name)),
  );
}
