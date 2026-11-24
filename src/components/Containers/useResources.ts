// Listas del motor (contenedores, imágenes, volúmenes, redes, espacio) y CPU/memoria de los que están
// en marcha: carga lo que pide la sub-pestaña visible, refresca mientras se ve y se vacía al cambiar
// de motor, de usuario o de elevación.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  findOwner,
  listContainers,
  listImages,
  listNetworks,
  listUnusedVolumes,
  listVolumes,
  mergeOwned,
  ownerKey,
  parseContainers,
  parseDf,
  parseImages,
  parseNetworks,
  parseStats,
  parseVolumes,
  readOwners,
  renderCmd,
  scriptFor,
  splitMarked,
  statsOnce,
  systemDf,
  type ContainerStats,
  type CtOwner,
  type Engine,
} from "../../features/containers";
import type { Resource, ResourceMap } from "./context";
import { neededResources, runningOwnersKey, type SubTab, type ResourceKind } from "../../features/containers/panelLogic";
import type { OwnerScope } from "./useOwnerScope";

const STATS_MS = 5000;
const LIST_MS = 15000;

function emptyRes<T>(): Resource<T> {
  return { data: null, loading: false, error: null, loadedAt: 0 };
}

function emptyMap(): ResourceMap {
  return { containers: emptyRes(), images: emptyRes(), volumes: emptyRes(), networks: emptyRes(), df: emptyRes() };
}

/** Script que lee un recurso (los volúmenes, junto con cuáles no se usan). */
function readScript(k: ResourceKind, engine: Engine): string {
  if (k === "volumes") {
    return `echo @@tv:all\n${renderCmd(listVolumes(engine))}\necho @@tv:unused\n${renderCmd(listUnusedVolumes(engine))}\necho @@tv:end`;
  }
  return scriptFor([{ containers: listContainers, images: listImages, networks: listNetworks, df: systemDf }[k](engine)]);
}

function parseResource(k: ResourceKind, out: string): object[] {
  if (k !== "volumes") return { containers: parseContainers, images: parseImages, networks: parseNetworks, df: parseDf }[k](out);
  const s = splitMarked(out);
  return parseVolumes(s.get("all") ?? "", (s.get("unused") ?? "").split("\n"));
}

type Args = Pick<OwnerScope, "runnable" | "elevation" | "engineKey" | "engine" | "runner" | "activeOwners" | "label" | "all" | "currentKey"> & {
  active: boolean;
  tab: SubTab;
  askSudo: () => void;
};

export function useResources({ active, tab, askSudo, runnable, elevation, engineKey, engine, runner, activeOwners, label, all, currentKey }: Args) {
  const [res, setRes] = useState<ResourceMap>(emptyMap);
  const [stats, setStats] = useState<ContainerStats[]>([]);
  /** Último error de cada dueño (para avisos con arreglo, p. ej. Podman con las carpetas de root). */
  const [ownerErrors, setOwnerErrors] = useState<Record<string, string>>({});

  const keyRef = useRef(engineKey);
  useEffect(() => {
    if (keyRef.current !== engineKey) {
      keyRef.current = engineKey;
      setRes(emptyMap());
      setStats([]);
      setOwnerErrors({});
    }
  }, [engineKey]);

  const setOne = useCallback(<K extends ResourceKind>(k: K, patch: Partial<ResourceMap[K]>) => {
    setRes((s) => ({ ...s, [k]: { ...s[k], ...patch } }));
  }, []);

  // Cada lista se lee de todos los dueños que se ven a la vez (un script por elevación); si un usuario
  // falla, se muestra su error y se ven igual los demás.
  const loadOne = useCallback(
    async (k: ResourceKind) => {
      if (!runnable || !elevation) return;
      const key = engineKey;
      setOne(k, { loading: true });
      const per = await readOwners(runner, activeOwners, readScript(k, engine), k === "df" ? 90 : 40);
      if (keyRef.current !== key) return;
      let needSudo = false;
      const parts = activeOwners.map((o) => {
        const r = per.get(ownerKey(o));
        if (r?.needSudo) needSudo = true;
        let data: object[] | null = null;
        if (r?.ok && r.result) {
          try {
            data = parseResource(k, r.result.stdout);
          } catch {
            data = null;
          }
        }
        return { owner: ownerKey(o), label: label(o), data, error: data === null ? (r?.error ?? "No se pudo leer") : null };
      });
      if (needSudo) askSudo();
      setOwnerErrors((prev) => {
        const next = { ...prev };
        for (const p of parts) {
          if (p.error) next[p.owner] = p.error;
          else delete next[p.owner];
        }
        return next;
      });
      const m = mergeOwned(parts);
      if (m.data !== null) setOne(k, { data: m.data as never, loading: false, error: m.error, loadedAt: Date.now() });
      else setOne(k, { loading: false, error: m.error ?? "No se pudo leer" });
    },
    [runnable, elevation, engineKey, engine, setOne, runner, activeOwners, label, askSudo],
  );

  const reload = useCallback(
    async (...kinds: ResourceKind[]) => {
      await Promise.all(kinds.map((k) => loadOne(k)));
    },
    [loadOne],
  );

  // Carga inicial de lo que necesita la sub-pestaña visible.
  useEffect(() => {
    if (!active || !runnable) return;
    const missing = neededResources(tab, all).filter((k) => res[k].loadedAt === 0 && !res[k].loading && !res[k].error);
    if (missing.length) void reload(...missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, runnable, tab, res, reload]);

  // Refresco periódico de la lista de contenedores mientras se ve.
  useEffect(() => {
    if (!active || !runnable || (tab !== "containers" && tab !== "compose")) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadOne("containers");
    }, LIST_MS);
    return () => window.clearInterval(t);
  }, [active, runnable, tab, loadOne]);

  // CPU / memoria cada ~5 s, solo si la pestaña se ve y hay contenedores en marcha (de cada dueño que los tenga).
  const runningBy = runningOwnersKey(res.containers.data, currentKey);
  const statsBusy = useRef(false);
  useEffect(() => {
    if (!active || !runnable || tab !== "containers" || !runningBy || !elevation) return;
    let stop = false;
    const key = engineKey;
    const owners = runningBy
      .split(",")
      .map((k) => findOwner(activeOwners, k))
      .filter((o): o is CtOwner => !!o);
    const tick = async () => {
      if (stop || statsBusy.current || document.visibilityState !== "visible") return;
      statsBusy.current = true;
      const per = await readOwners(runner, owners, scriptFor([statsOnce(engine)]), 20);
      statsBusy.current = false;
      if (stop || keyRef.current !== key) return;
      const next: ContainerStats[] = [];
      for (const o of owners) {
        const r = per.get(ownerKey(o));
        if (r?.ok && r.result) next.push(...parseStats(r.result.stdout).map((s) => ({ ...s, owner: ownerKey(o) })));
      }
      setStats(next);
    };
    void tick();
    const t = window.setInterval(() => void tick(), STATS_MS);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [active, runnable, tab, runningBy, engine, elevation, engineKey, runner, activeOwners]);

  return { res, stats, reload, ownerErrors };
}
