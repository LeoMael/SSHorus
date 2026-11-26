// Filtros de la tabla «Vulnerabilidades» y sus filas. Si otra parte de la app pide ver una imagen
// (useVulnNav), se filtra por ella o se avisa de que no está en el último análisis.
import { useEffect, useMemo, useState } from "react";
import type { Report } from "../../../api/vulnscan";
import { useVulnNav } from "../../../features/vulnscan";
import { buildVulnRows, filterFindings, NO_FILTERS, type VulnFilters } from "../../../features/vulnscan/findingRows";
import { toast } from "../../../stores/toasts";

export function useVulnFilters(sessionId: string, report: Report | null | undefined) {
  const [filters, setFilters] = useState<VulnFilters>(NO_FILTERS);
  const [kernelOpen, setKernelOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ id: string; label: string } | null>(null);
  const set = <K extends keyof VulnFilters>(k: K) => (v: VulnFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  const nav = useVulnNav((s) => s.request);
  const navDone = useVulnNav((s) => s.done);
  useEffect(() => {
    if (!nav || nav.sessionId !== sessionId) return;
    setPendingImage({ id: nav.imageId, label: nav.label });
    navDone(nav.seq);
  }, [nav, sessionId, navDone]);
  useEffect(() => {
    if (!pendingImage || report === undefined) return;
    const t = report?.targets.find((x) => x.kind === "image" && x.image?.id.startsWith(pendingImage.id));
    if (t) {
      setFilters((f) => ({ ...f, origin: t.key, severity: "all", query: "" }));
    } else {
      toast.info(
        `«${pendingImage.label}» no está en el último análisis`,
        report ? "Pulsa «Analizar» para incluirla (o revisa el límite de imágenes en las opciones)." : "Pulsa «Analizar».",
      );
    }
    setPendingImage(null);
  }, [pendingImage, report]);

  const all = useMemo(() => report?.findings ?? [], [report]);
  const unimportantCount = useMemo(() => all.filter((f) => f.unimportant).length, [all]);
  const filtered = useMemo(() => filterFindings(report, all, filters), [all, report, filters]);
  const rows = useMemo(() => buildVulnRows(filtered, kernelOpen), [filtered, kernelOpen]);

  return {
    filters,
    setSeverity: set("severity"),
    setOrigin: set("origin"),
    setOnlyFix: set("onlyFix"),
    setFixFilter: set("fixFilter"),
    setShowUnimportant: set("showUnimportant"),
    setQuery: set("query"),
    /** «Quitar filtros»: deja la casilla de «sin importancia» como estaba. */
    clear: () => setFilters((f) => ({ ...NO_FILTERS, showUnimportant: f.showUnimportant })),
    toggleKernel: () => setKernelOpen((o) => !o),
    all,
    unimportantCount,
    filtered,
    rows,
  };
}
