// Consumo de los contenedores (`docker|podman stats --no-stream`): comando y lectura de su salida.

export interface ContainerStat {
  engine: "docker" | "podman";
  id: string;
  name: string;
  cpuPct: number | null;
  memUsage: string;
  memPct: number | null;
  netIO: string;
  blockIO: string;
}

export interface ContainersResult {
  engines: ("docker" | "podman")[];
  containers: ContainerStat[];
  /** Mensajes de error por motor (permiso denegado, demonio parado…). */
  errors: { engine: string; message: string }[];
}

export const CONTAINERS_TIMEOUT_SECS = 20;

const STATS_FORMAT = "{{.ID}}|{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}";

export function buildContainersCommand(): string {
  const script = [
    "for c in docker podman; do if command -v $c >/dev/null 2>&1; then echo @@engine=$c",
    `$c stats --no-stream --format "${STATS_FORMAT}" 2>&1 | head -n 80; fi; done`,
    "echo @@end",
  ].join("; ");
  return `sh -c '${script}'`;
}

const pctOf = (s: string | undefined): number | null => {
  const v = parseFloat((s ?? "").replace(",", ".").replace("%", ""));
  return Number.isFinite(v) ? v : null;
};

export function parseContainers(stdout: string): ContainersResult {
  const res: ContainersResult = { engines: [], containers: [], errors: [] };
  let engine: "docker" | "podman" | null = null;
  const errLines = new Map<string, string[]>();
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/\r$/, "").trim();
    const m = /^@@engine=(docker|podman)$/.exec(line);
    if (m) {
      engine = m[1] as "docker" | "podman";
      res.engines.push(engine);
      continue;
    }
    if (!engine || !line || line.startsWith("@@")) continue;
    const f = line.split("|");
    if (f.length >= 7) {
      res.containers.push({
        engine,
        id: f[0].slice(0, 12),
        name: f[1],
        cpuPct: pctOf(f[2]),
        memUsage: f[3],
        memPct: pctOf(f[4]),
        netIO: f[5],
        blockIO: f[6],
      });
    } else {
      const arr = errLines.get(engine) ?? [];
      arr.push(line);
      errLines.set(engine, arr);
    }
  }
  // `docker` puede ser el envoltorio de podman: mismos contenedores dos veces.
  const seen = new Set<string>();
  res.containers = res.containers.filter((c) => {
    const k = `${c.id}|${c.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Errores solo si no se pudo leer nada (p. ej. sin permiso en docker pero podman va bien: no molestar).
  if (!res.containers.length) {
    for (const [eng, lines] of errLines) res.errors.push({ engine: eng, message: lines.slice(0, 3).join(" ") });
  }
  return res;
}
