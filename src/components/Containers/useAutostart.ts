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
  type CtOwner,
  type Engine,
  type EngineRun,
  type EngineStatus,
  type OwnerAutostart,
} from "../../features/containers";

interface Args {
  engine: Engine;
  owners: CtOwner[];
  status: EngineStatus | null;
  active: boolean;
  containers: Container[] | null;
  runRawAs: (owner: string | undefined, script: string, timeoutSecs?: number) => Promise<EngineRun>;
  isRoot: boolean;
}

export function useAutostart({ engine, owners, status, active, containers, runRawAs, isRoot }: Args) {
  const rootless = !!status?.rootless;
  const needsSudo = !!status?.needsSudo;
  const version = status?.version ?? null;

  const ownerInfo = useMemo(() => {
    const ctx = { engine, isRoot, rootless, selfSudo: engine === "docker" && needsSudo && !isRoot };
    return new Map<string, AutostartOwner>(owners.map((o) => [ownerKey(o), autostartOwner(o, ctx)]));
  }, [engine, owners, isRoot, rootless, needsSudo]);

  const [facts, setFacts] = useState<Map<string, OwnerAutostart>>(() => new Map());
  /** Por dueño: por qué no se pudo leer (para «Sin datos» en la columna). */
  const [errors, setErrors] = useState<Map<string, string>>(() => new Map());
  const [loading, setLoading] = useState(false);

  const scopeKey = `${engine}|${[...ownerInfo.keys()].join(",")}`;
  const idsKey = `${scopeKey}|${(containers ?? []).map((c) => `${c.owner ?? ""}/${c.id}`).sort().join(",")}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  useEffect(() => {
    setFacts(new Map());
    setErrors(new Map());
  }, [scopeKey]);

  /** Vuelve a leer y devuelve lo leído (para enseñar el estado nuevo tras un cambio). */
  const reload = useCallback(async (): Promise<Map<string, OwnerAutostart>> => {
    const key = scopeKey;
    setLoading(true);
    const read = await Promise.all(
      [...ownerInfo.values()].map(async (o) => {
        const r = await runRawAs(o.key, autostartScript(o.scope), 30);
        const f = r.ok && r.result ? parseAutostart(r.result.stdout) : null;
        return { key: o.key, f, error: f ? null : (r.error ?? "el servidor no respondió") };
      }),
    );
    const next = new Map(read.flatMap((x) => (x.f ? [[x.key, x.f] as const] : [])));
    if (scopeRef.current !== key) return next;
    setLoading(false);
    setFacts(next);
    setErrors(new Map(read.flatMap((x) => (x.error ? [[x.key, x.error] as const] : []))));
    return next;
  }, [scopeKey, ownerInfo, runRawAs]);

  const hasContainers = !!containers && containers.length > 0;
  useEffect(() => {
    if (active && status && hasContainers) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, !!status, idsKey]);

  const infoOf = useCallback(
    (c: Container): AutostartInfo | null => {
      const k = c.owner ?? "";
      const f = facts.get(k);
      const o = ownerInfo.get(k);
      return f && o ? decideAutostart(c.id, f, o.scope, version) : null;
    },
    [facts, ownerInfo, version],
  );

  /** Por qué no hay datos de un contenedor (null = los hay, o se están leyendo). */
  const noDataOf = useCallback(
    (c: Container): string | null => {
      if (loading) return null;
      const k = c.owner ?? "";
      const err = errors.get(k);
      if (err) return `no se pudo leer cómo arranca (${err})`;
      if (!facts.has(k)) return "todavía no se ha leído; pulsa «Actualizar»";
      return infoOf(c) ? null : "el contenedor no salió en la lectura (puede que se acabe de crear); pulsa «Actualizar»";
    },
    [loading, errors, facts, infoOf],
  );

  const ownerOf = useCallback((k: string) => ownerInfo.get(k) ?? null, [ownerInfo]);
  const factsOf = useCallback((k: string) => facts.get(k) ?? null, [facts]);
  /** Decide con unos datos dados (p. ej. los que devuelve `reload`). */
  const decideWith = useCallback(
    (all: Map<string, OwnerAutostart>, id: string, owner: string): AutostartInfo | null => {
      const f = all.get(owner);
      const o = ownerInfo.get(owner);
      return f && o ? decideAutostart(id, f, o.scope, version) : null;
    },
    [ownerInfo, version],
  );

  return useMemo(
    () => ({ infoOf, noDataOf, ownerOf, factsOf, decideWith, loading, reload }),
    [infoOf, noDataOf, ownerOf, factsOf, decideWith, loading, reload],
  );
}

export type AutostartState = ReturnType<typeof useAutostart>;
