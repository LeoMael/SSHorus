// Panel de VPS con todos los servidores de la vista previa: web-prod (dos usuarios guardados, contenedores),
// db-01 (disco y memoria casi llenos, un servicio caído, reinicio pendiente), lab-docker (un contenedor
// caído), api-staging (pide contraseña: espera a «Conectar») y backup (no responde).
// Para tener la mini gráfica sin esperar 10 minutos, el reloj de la página avanza 20 s en cada ronda.
import { extra } from "../motor";
import { openFleet } from "../../../../src/features/fleet/store";
import { fleetRetry, useFleetLive } from "../../../../src/features/fleet/runtime";
import { useProfiles } from "../../../../src/stores/profiles";
import { app, el, sleep } from "../ayuda";

interface Perfil {
  nproc: number;
  busy: (t: number) => number;
  mem: (t: number) => number;
  disk: number;
  failed: string[];
  ct: string[] | null;
  os: string;
  host: string;
  reboot: boolean;
  updates: number;
  users: Record<string, string>;
}

const wave = (t: number, ms: number, a: number, b: number) => a + (b - a) * (0.5 + 0.5 * Math.sin(t / ms));

const PERFILES: Record<string, Perfil> = {
  "s-web": {
    nproc: 4,
    busy: (t) => wave(t, 40_000, 0.15, 0.45),
    mem: (t) => wave(t, 90_000, 58, 66),
    disk: 71,
    failed: [],
    ct: ["tienda-web|running|Up 3 days", "tienda-app|running|Up 3 days", "redis|running|Up 3 days", "migracion|exited|Exited (0) 3 days ago"],
    os: "Ubuntu 24.04.1 LTS",
    host: "web-prod",
    reboot: false,
    updates: 4,
    users: { deploy: "1000:deploy sudo docker", ana: "1001:ana docker" },
  },
  "s-db": {
    nproc: 2,
    busy: (t) => wave(t, 25_000, 0.3, 0.7),
    mem: (t) => wave(t, 60_000, 90, 95),
    disk: 94,
    failed: ["pg-backup.service"],
    ct: null,
    os: "Debian GNU/Linux 12 (bookworm)",
    host: "db-01",
    reboot: true,
    updates: 0,
    users: { admin: "1000:admin sudo" },
  },
  "s-lab": {
    nproc: 8,
    busy: (t) => wave(t, 15_000, 0.05, 0.3),
    mem: (t) => wave(t, 120_000, 35, 45),
    disk: 38,
    failed: [],
    ct: ["worker|exited|Exited (137) 5 minutes ago", "grafana|running|Up 2 hours", "prometheus|running|Up 2 hours"],
    os: "Fedora Linux 44 (Server Edition)",
    host: "lab",
    reboot: false,
    updates: -1,
    users: { ana: "1000:ana wheel" },
  },
};

const started = Date.now();
const counters = new Map<string, { at: number; total: number; idle: number }>();
const sessions = new Map<string, string>();

function salida(profileId: string): string {
  const p = PERFILES[profileId];
  const t = Date.now();
  const c = counters.get(profileId) ?? { at: t - 15_000, total: 5_000_000, idle: 4_000_000 };
  const dt = ((t - c.at) / 1000) * 100 * p.nproc;
  const next = { at: t, total: c.total + dt, idle: c.idle + dt * (1 - p.busy(t)) };
  counters.set(profileId, next);
  const memTotal = 4_000_000 * p.nproc;
  const avail = Math.round(memTotal * (1 - p.mem(t) / 100));
  const used = Math.round(50_000_000 * (p.disk / 100));
  const lines = [
    "@@begin",
    "@@stat",
    `cpu  ${Math.round(next.total - next.idle)} 0 0 ${Math.round(next.idle)} 0 0 0 0 0 0`,
    "@@mem",
    `MemTotal: ${memTotal} kB`,
    `MemFree: ${Math.round(avail / 3)} kB`,
    `MemAvailable: ${avail} kB`,
    "@@load",
    `${(p.busy(t) * p.nproc).toFixed(2)} ${(p.busy(t - 300_000) * p.nproc).toFixed(2)} ${(p.nproc * 0.3).toFixed(2)} 1/300 4242`,
    "@@up",
    `${1_234_567 + (t - started) / 1000} 1.0`,
    "@@nproc",
    String(p.nproc),
    "@@host",
    p.host,
    "@@os",
    `PRETTY_NAME="${p.os}"`,
    ...(p.updates >= 0 ? [`@@reboot=${p.reboot ? 1 : 0}`, "@@updates", p.updates ? `${p.updates} updates can be applied immediately.` : ""] : []),
    "@@failed",
    ...p.failed.map((u) => `${u} loaded failed failed Copia de la base de datos`),
    ...(p.ct ? ["@@ct=docker", ...p.ct] : []),
    "@@users",
    ...Object.entries(p.users).map(([u, rest]) => `${u}:${rest.split(":")[0]}:${rest.split(":")[1]}`),
    "@@df",
    "Filesystem 1024-blocks Used Available Capacity Mounted on",
    `/dev/vda1 50000000 ${used} ${50_000_000 - used} ${p.disk}% /`,
    "/dev/vdb1 200000000 80000000 120000000 40% /data",
    "@@end",
  ];
  return lines.join("\n");
}

export const escenas: Record<string, () => Promise<void>> = {
  panel: async () => {
    await app();
    const realNow = Date.now.bind(Date);
    let offset = 0;
    Date.now = () => realNow() + offset;
    const base = extra.ssh_connect;
    let n = 0;
    extra.ssh_connect = (a) => {
      const id = String(a?.profileId);
      if (id === "s-api") throw { kind: "NeedsPassword", message: "Falta la contraseña" };
      if (id === "s-backup") throw { kind: "Network", message: "No se pudo conectar a 198.51.100.44:22 (tiempo agotado)" };
      const info = base ? (base(a) as { id: string }) : { id: `fl-${++n}` };
      sessions.set(info.id, id);
      return info;
    };
    extra.exec_capture = (a) => {
      const profileId = sessions.get(String(a?.sessionId)) ?? "";
      const stdout = PERFILES[profileId] ? salida(profileId) : "";
      return { stdout, stderr: "", exitCode: 0, durationMs: 40 + profileId.length * 7, truncated: false, timedOut: false };
    };
    const web = useProfiles.getState().servers.find((s) => s.id === "s-web");
    if (web) {
      useProfiles.setState((s) => ({
        servers: [...s.servers, { ...web, id: "s-web-ana", username: "ana", color: null }],
        projects: s.projects.map((p) => (p.id === "p-tienda" ? { ...p, serverIds: [...p.serverIds, "s-web-ana"] } : p)),
      }));
    }
    openFleet();
    await el(".fl-card", 10000);
    for (let i = 0; i < 30; i++) {
      await sleep(250);
      offset += 20_000;
      for (const key of Object.keys(useFleetLive.getState().live)) fleetRetry(key);
    }
    await sleep(600);
  },
};
