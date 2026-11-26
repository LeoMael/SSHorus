// Pruebas de «Limpiar sin usar» de Volúmenes y Redes: qué se borra, un comando por dueño con «Todos» y
// por qué el botón está desactivado.
import {
  NETWORK_PRUNE_TEXTS,
  VOLUME_PRUNE_TEXTS,
  pruneBlocked,
  pruneNetworksCmds,
  pruneVolumesCmds,
  unusedNetworks,
  volumePruneCandidates,
} from "./prune";
import { renderCmd } from "./shell";
import type { Container, NetworkInfo, VolumeInfo } from "./types";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const LEO = "u:leo";
function vol(name: string, owner: string | undefined, unused: boolean, anonymous = false): VolumeInfo {
  return { name, driver: "local", mountpoint: "", created: null, labels: {}, anonymous, unused, owner };
}
function net(name: string, owner: string | undefined, builtin = false): NetworkInfo {
  return { id: name, name, driver: "bridge", subnets: [], internal: false, created: null, labels: {}, builtin, owner };
}
function ctr(name: string, networks: string[], owner: string | undefined): Container {
  return {
    id: `${name}-id`,
    shortId: name,
    name,
    image: "x",
    state: "exited",
    status: "",
    exitCode: 0,
    health: null,
    created: null,
    ports: [],
    labels: {},
    networks,
    command: "",
    composeProject: null,
    composeService: null,
    composeWorkingDir: null,
    composeConfigFiles: null,
    pod: null,
    owner,
  };
}
const owners = (cmds: { owner?: string }[]) => cmds.map((c) => c.owner ?? null);

// ── Volúmenes ──
const vols = [vol("datos", LEO, true), vol("a".repeat(64), LEO, true, true), vol("db", "root", false), vol("cache", "root", true)];
eq(volumePruneCandidates(vols, "podman", false).length, 3, "Podman: todos los sin usar");
eq(volumePruneCandidates(vols, "docker", false).map((v) => v.name), ["a".repeat(64)], "Docker sin -a: solo los anónimos");
eq(volumePruneCandidates(vols, "docker", true).length, 3, "Docker con -a: también los que tienen nombre");
eq(owners(pruneVolumesCmds(vols, "podman", false)), [LEO, "root"], "con «Todos», un prune por dueño");
eq(renderCmd(pruneVolumesCmds(vols, "docker", true)[0]), "docker volume prune -f -a", "-a en Docker");
eq(owners(pruneVolumesCmds(vols, "docker", false)), [LEO], "root solo tiene uno con nombre: sin -a no se limpia como root");
eq(owners(pruneVolumesCmds([vol("x", undefined, true)], "podman", false)), [null], "un solo dueño: sin marcar (va como el elegido)");
eq(pruneVolumesCmds([vol("db", "root", false)], "podman", false).length, 0, "nada sin usar: sin comandos");

// ── Redes ──
const nets = [net("podman", LEO, true), net("web", LEO), net("libre", LEO), net("libre", "root")];
const containers = [ctr("app", ["web"], LEO), ctr("otro", ["libre"], "u:ana")];
eq(unusedNetworks(nets, containers).map((n) => `${n.owner}/${n.name}`), [`${LEO}/libre`, "root/libre"], "sin integradas ni usadas; el contenedor de otro usuario no cuenta");
eq(owners(pruneNetworksCmds(nets, containers, "podman")), [LEO, "root"], "un prune por dueño");
eq(renderCmd(pruneNetworksCmds(nets, containers, "docker")[0]), "docker network prune -f", "comando de Docker");
eq(pruneNetworksCmds([net("web", LEO)], containers, "podman").length, 0, "todas en uso: sin comandos");

// ── Por qué está desactivado ──
const st = (o: Partial<{ loaded: boolean; error: string | null; total: number; candidates: number }>) => ({ loaded: true, error: null, total: 1, candidates: 1, ...o });
eq(pruneBlocked(st({ loaded: false }), VOLUME_PRUNE_TEXTS), "todavía se están leyendo los volúmenes", "leyendo");
eq(pruneBlocked(st({ loaded: false, error: "x" }), NETWORK_PRUNE_TEXTS), "no se pudieron leer las redes (mira el error de arriba)", "error al leer");
eq(pruneBlocked(st({ total: 0, candidates: 0 }), VOLUME_PRUNE_TEXTS), "no hay volúmenes en el servidor", "sin volúmenes");
eq(pruneBlocked(st({ total: 0, candidates: 0 }), NETWORK_PRUNE_TEXTS), "solo están las redes integradas, que no se borran", "solo integradas");
eq(pruneBlocked(st({ candidates: 0 }), NETWORK_PRUNE_TEXTS)?.startsWith("todas las redes las usa"), true, "todas en uso");
eq(pruneBlocked(st({}), VOLUME_PRUNE_TEXTS), null, "se puede (también con «Todos»)");

console.log(`limpiar sin usar: ${passed} pruebas correctas`);
