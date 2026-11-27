// Lee de cada registro lo de un servidor y lo junta en la línea de tiempo. Si un registro falla, el resto
// se ve igual y se dice cuál faltó.
import { useCallback, useEffect, useMemo, useState } from "react";
import { audit } from "../../api/audit";
import { errorMessage } from "../../api/core";
import { mcp } from "../../api/mcp";
import { serverHistory } from "../../api/serverHistory";
import { vulnscan } from "../../api/vulnscan";
import { useAdminHistory, useHistoryOf } from "../../features/admin";
import { fromAdmin, fromAi, fromAudit, fromEvent, fromVuln, mergeTimeline, useHistorySeq, type TimelineItem } from "../../features/serverHistory";

/** Cada registro que vive en el motor: nombre (para el aviso si falla) y cómo se lee. */
const REMOTE: { label: string; load: (id: string) => Promise<TimelineItem[]> }[] = [
  { label: "este historial", load: async (id) => (await serverHistory.list(id)).map(fromEvent) },
  { label: "el registro del asistente de IA", load: async (id) => (await mcp.activityForServer(id)).map(fromAi) },
  { label: "las auditorías", load: async (id) => (await audit.historyList(id)).map(fromAudit) },
  { label: "los análisis del escáner", load: async (id) => (await vulnscan.historyList(id)).map(fromVuln) },
];

interface Remote {
  items: TimelineItem[];
  problems: string[];
  loading: boolean;
}

export function useTimeline(serverId: string) {
  const ensureAdmin = useAdminHistory((s) => s.ensure);
  const admin = useHistoryOf(serverId);
  const seq = useHistorySeq((s) => s.seq);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [remote, setRemote] = useState<Remote>({ items: [], problems: [], loading: true });

  useEffect(() => ensureAdmin(serverId), [ensureAdmin, serverId]);

  useEffect(() => {
    let alive = true;
    void Promise.allSettled(REMOTE.map((r) => r.load(serverId))).then((res) => {
      if (!alive) return;
      const items: TimelineItem[][] = [];
      const problems: string[] = [];
      res.forEach((r, i) => {
        if (r.status === "fulfilled") items.push(r.value);
        else problems.push(`No se pudo leer ${REMOTE[i].label}: ${errorMessage(r.reason)}`);
      });
      setRemote({ items: items.flat(), problems, loading: false });
    });
    return () => {
      alive = false;
    };
  }, [serverId, seq, reloadSeq]);

  const items = useMemo(() => mergeTimeline([admin.map(fromAdmin), remote.items]), [admin, remote.items]);
  const reload = useCallback(() => setReloadSeq((n) => n + 1), []);
  return { items, problems: remote.problems, loading: remote.loading, reload };
}
