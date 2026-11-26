// Informe de vulnerabilidades de la conexión: carga el último guardado si aún no hay ninguno en
// pantalla y lo compara con el análisis anterior (qué es nuevo y qué se arregló).
import { useEffect, useState } from "react";
import { vulnscan, type Report } from "../../../api/vulnscan";
import { useVulnScan } from "../../../features/vulnscan";
import { diffReports, type ScanDiff } from "./VulnSummary";

export function useVulnReport(sessionId: string, profileId: string): { report: Report | null | undefined; diff: ScanDiff | null } {
  const report = useVulnScan((s) => s.reports[sessionId]);
  const setReport = useVulnScan((s) => s.setReport);
  const [diff, setDiff] = useState<ScanDiff | null>(null);

  useEffect(() => {
    if (report !== undefined) return;
    let alive = true;
    vulnscan.latest(profileId).then(
      (r) => alive && setReport(sessionId, r),
      () => alive && setReport(sessionId, null),
    );
    return () => {
      alive = false;
    };
  }, [report, profileId, sessionId, setReport]);

  useEffect(() => {
    setDiff(null);
    if (!report) return;
    let alive = true;
    (async () => {
      const list = await vulnscan.historyList(profileId);
      const i = list.findIndex((m) => m.id === report.id);
      const prev = i >= 0 ? list[i + 1] : undefined;
      if (!prev) return;
      const old = await vulnscan.historyGet(profileId, prev.id);
      if (alive) setDiff(diffReports(report, old));
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [report, profileId]);

  return { report, diff };
}
