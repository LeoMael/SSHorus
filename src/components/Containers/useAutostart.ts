// «¿Se reinicia solo?» de la lista de contenedores: lee, de cada dueño que se ve, la política de reinicio,
// sus unidades de systemd, el servicio de arranque y el linger (un script por dueño, a la vez). Se vuelve
// a leer cuando cambian los contenedores (no en cada refresco) y tras activarlo o desactivarlo.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  autostartOwner,
  autostartScript,
  decideAutostart,
  ownerKey,
  parseAutostart,
  type AutostartInfo,
  type AutostartOwner,
  type Container,
  type OwnerAutostart,
} from "../../features/containers";
import { useCt } from "./context";

export function useAutostart() {
  const ct = useCt();
  const { engine, owners, status, active, runRawAs, ownerIsRoot } = ct;
  const containers = ct.res.containers.data;
  const isRoot = ownerIsRoot("self");

  const ownerInfo = useMemo(() => {
    const ctx = { engine, isRoot, rootless: status.rootless, selfSudo: engine === "docker" && status.needsSudo && !isRoot };
    return new Map<string, AutostartOwner>(owners.map((o) => [ownerKey(o), autostartOwner(o, ctx)]));
  }, [engine, owners, isRoot, status.rootless, status.needsSudo]);

  const [facts, setFacts] = useState<Map<string, OwnerAutostart>>(() => new Map());
  const [loading, setLoading] = useState(false);

  const scopeKey = `${engine}|${[...ownerInfo.keys()].join(",")}`;
  const idsKey = `${scopeKey}|${(containers ?? []).map((c) => `${c.owner ?? ""}/${c.id}`).sort().join(",")}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  useEffect(() => setFacts(new Map()), [scopeKey]);

  const reload = useCallback(async () => {
    const key = scopeKey;
    setLoading(true);
    const read = await Promise.all(
      [...ownerInfo.values()].map(async (o) => {
        const r = await runRawAs(o.key, autostartScript(o.scope), 30);
        return [o.key, r.ok && r.result ? parseAutostart(r.result.stdout) : null] as const;
      }),
    );
    if (scopeRef.current !== key) return;
    setLoading(false);
    setFacts(new Map(read.filter((x): x is [string, OwnerAutostart] => x[1] !== null)));
  }, [scopeKey, ownerInfo, runRawAs]);

  const hasContainers = !!containers && containers.length > 0;
  useEffect(() => {
    if (active && hasContainers) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, idsKey]);

  const infoOf = useCallback(
    (c: Container): AutostartInfo | null => {
      const k = c.owner ?? "";
      const f = facts.get(k);
      const o = ownerInfo.get(k);
      return f && o ? decideAutostart(c.id, f, o.scope, status.version) : null;
    },
    [facts, ownerInfo, status.version],
  );

  const ownerOf = useCallback((k: string) => ownerInfo.get(k) ?? null, [ownerInfo]);
  const factsOf = useCallback((k: string) => facts.get(k) ?? null, [facts]);

  return { infoOf, ownerOf, factsOf, loading, reload };
}

export type AutostartState = ReturnType<typeof useAutostart>;
