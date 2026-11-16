// Estado de «Arreglar» y «Volver a comprobar» en la pestaña Vulnerabilidades.
import { useCallback, useRef, useState } from "react";
import { errorMessage } from "../../api/core";
import type { Finding, Report } from "../../api/vulnscan";
import { crossReports, crossSummary, fixKind, recheckSystem, UpdateCancel, UpdateCanceled, useVulnScan } from "../../features/vulnscan";
import { useSettings } from "../../stores/settings";
import { toast } from "../../stores/toasts";

export function useVulnFix(sessionId: string, report: Report | null | undefined) {
  /** Hallazgos que se quieren arreglar (diálogo abierto) o null. */
  const [fixScope, setFixScope] = useState<Finding[] | null>(null);
  /** Progreso de «Volver a comprobar» (null = no está en curso). */
  const [checking, setChecking] = useState<string | null>(null);
  const cancel = useRef<UpdateCancel | null>(null);

  /** Abre «Arreglar» con los arreglables de `findings` (y los de su mismo paquete, que se arreglan juntos). */
  const openFix = useCallback(
    (findings: Finding[]) => {
      if (!report) return;
      const pkgs = new Set(findings.map((f) => `${f.target}|${f.package}`));
      const scope = report.findings.filter((f) => !f.unimportant && pkgs.has(`${f.target}|${f.package}`) && fixKind(report, f) === "now");
      if (scope.length) setFixScope(scope);
    },
    [report],
  );

  const recheck = useCallback(async () => {
    if (!report || checking) return;
    const c = new UpdateCancel();
    cancel.current = c;
    const before = report.findings.filter((f) => !f.unimportant && !f.target.startsWith("image:"));
    setChecking("Empezando…");
    try {
      const next = await recheckSystem({ sessionId, report, settings: useSettings.getState().settings.vulnscan, cancel: c, onProgress: setChecking });
      useVulnScan.getState().setReport(sessionId, next);
      const x = crossReports(before, next);
      toast.success("Sistema comprobado de nuevo", crossSummary(x));
    } catch (e) {
      if (!(e instanceof UpdateCanceled)) toast.error("No se pudo volver a comprobar", errorMessage(e));
    } finally {
      setChecking(null);
      cancel.current = null;
    }
  }, [sessionId, report, checking]);

  const cancelRecheck = useCallback(() => void cancel.current?.cancel(), []);

  return { fixScope, openFix, closeFix: () => setFixScope(null), checking, recheck, cancelRecheck };
}
