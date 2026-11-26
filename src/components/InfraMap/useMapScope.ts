// «Lo mío» / «Todo el servidor» en el lienzo: alcance de cada servidor, grafo recortado y frases que
// explican lo que se ve. La regla está en features/infra/scope.ts.
import { useMemo } from "react";
import type { InfraGraph, ServerSnapshot } from "../../features/infra";
import { mapNotes, mineUsers, scopeGraph, serverScopes, type MapScope } from "../../features/infra/scope";
import { setMapScope, useMapScopes } from "../../features/infra/scopeMemory";

export function useMapScope(snapshots: ServerSnapshot[] | null, full: InfraGraph | null) {
  const chosen = useMapScopes((s) => s.chosen);
  const snaps = useMemo(() => snapshots ?? [], [snapshots]);
  const scopes = useMemo(() => serverScopes(snaps, chosen), [snaps, chosen]);
  const graph = useMemo(() => (full ? scopeGraph(full, mineUsers(snaps, scopes)) : null), [full, snaps, scopes]);
  const notes = useMemo(() => mapNotes(snaps, scopes), [snaps, scopes]);

  const values = [...scopes.values()];
  /** null = no hay qué elegir o (en un proyecto) cada servidor está en uno distinto. */
  const current: MapScope | null = values.length && values.every((v) => v === values[0]) ? values[0] : null;
  return {
    available: scopes.size > 0,
    current,
    anyMine: values.includes("mine"),
    graph,
    notes,
    /** Cambia con el alcance (la vista se reajusta entonces). */
    key: [...scopes].map(([id, v]) => `${id}=${v}`).join(","),
    setAll: (v: MapScope) => setMapScope([...scopes.keys()], v),
    showAll: (serverId: string) => setMapScope([serverId], "all"),
  };
}
