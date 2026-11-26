// «Analizar servidor»: lanza el informe de solo lectura y guarda su estado. Si el informe trae la
// distribución, la apunta para la sesión (la usan los comandos de dnf/apt/apk).
import { useCallback, useState } from "react";
import { errorMessage } from "../../api/core";
import { snippets as snippetsApi } from "../../api/snippets";
import { ANALYSIS_COMMAND, ANALYSIS_TIMEOUT_SECS, parseReport } from "../../features/commands/analysis";
import { setSessionInfo, type SessionInfoCache } from "../../features/commands/state";
import type { AnalysisState } from "./AnalysisReport";

export function useServerAnalysis(sessionId: string, onInfo: (info: SessionInfoCache) => void) {
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [showReport, setShowReport] = useState(false);

  const runAnalysis = useCallback(async () => {
    setShowReport(true);
    // Mientras corre se sigue viendo el informe anterior.
    setAnalysis((a) => ({
      running: true,
      report: a?.report ?? null,
      raw: a?.raw ?? "",
      stderr: "",
      error: null,
      at: a?.at ?? 0,
      durationMs: 0,
    }));
    try {
      const r = await snippetsApi.exec(sessionId, ANALYSIS_COMMAND, ANALYSIS_TIMEOUT_SECS);
      const report = parseReport(r.stdout, r.timedOut);
      if (report.osId) {
        const next = { distro: report.distro, osId: report.osId, osName: report.osName };
        setSessionInfo(sessionId, next);
        onInfo(next);
      }
      setAnalysis({
        running: false,
        report,
        raw: r.stdout,
        stderr: r.stderr,
        error: r.stdout.trim() ? null : r.stderr.trim() || "El servidor no devolvió datos.",
        at: Date.now(),
        durationMs: r.durationMs,
      });
    } catch (e) {
      setAnalysis((a) => ({
        running: false,
        report: a?.report ?? null,
        raw: a?.raw ?? "",
        stderr: "",
        error: `No se pudo analizar el servidor: ${errorMessage(e)}`,
        at: a?.at ?? 0,
        durationMs: 0,
      }));
    }
  }, [sessionId, onInfo]);

  return { analysis, showReport, setShowReport, runAnalysis };
}
