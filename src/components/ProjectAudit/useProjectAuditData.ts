// Datos del diálogo «Auditar proyecto»: los servidores del proyecto, su último informe guardado y cómo va cada
// uno en la tarea (lo de ahora pisa a lo guardado).
import { useEffect, useMemo, useState } from "react";
import { audit, type AuditReport } from "../../api/audit";
import type { Project, ServerProfile } from "../../api/types";
import { IDLE_ROW, useProjectAudit, type ServerAuditEntry, type ServerAuditRow } from "../../features/audit";
import { useProfiles } from "../../stores/profiles";

export interface ProjectAuditItem extends ServerAuditEntry {
  server: ServerProfile;
  row: ServerAuditRow;
}

export function useProjectAuditData(projectId: string): { project: Project | null; items: ProjectAuditItem[]; loading: boolean } {
  const project = useProfiles((s) => s.projects.find((p) => p.id === projectId) ?? null);
  const all = useProfiles((s) => s.servers);
  const rows = useProjectAudit((s) => s.rows);
  const servers = useMemo(() => {
    const byId = new Map(all.map((s) => [s.id, s]));
    return (project?.serverIds ?? []).map((id) => byId.get(id)).filter((s): s is ServerProfile => !!s);
  }, [all, project]);
  const [saved, setSaved] = useState<Record<string, AuditReport | null>>({});
  const [loading, setLoading] = useState(true);
  const key = servers.map((s) => s.id).join(",");
  // Al terminar cada servidor se vuelve a leer lo guardado (así «Arreglar» en Administración se ve aquí).
  const doneKey = servers.map((s) => (rows[s.id]?.status === "done" ? rows[s.id]?.report?.id : "")).join(",");

  useEffect(() => {
    let alive = true;
    const ids = key ? key.split(",") : [];
    void Promise.all(ids.map(async (id) => [id, await audit.latest(id).catch(() => null)] as const)).then((list) => {
      if (!alive) return;
      setSaved(Object.fromEntries(list));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [key, doneKey]);

  const items = useMemo(
    () =>
      servers.map((server) => {
        const row = rows[server.id] ?? IDLE_ROW;
        const kept = saved[server.id] ?? null;
        // El más nuevo; a igual fecha, el guardado (ya lleva lo arreglado después).
        const report = row.report && (!kept || row.report.createdAt > kept.createdAt) ? row.report : kept;
        return { profileId: server.id, name: server.name, server, row, report };
      }),
    [servers, rows, saved],
  );
  return { project, items, loading };
}
