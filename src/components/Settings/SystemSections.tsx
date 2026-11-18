// Ajustes → Avanzado (diagnóstico) y Manual de uso: envoltorios finos de paneles que viven en otra parte.
import { lazy, Suspense } from "react";
import { DiagnosticsPanel } from "../Diagnostics/DiagnosticsPanel";

// El manual (texto e imágenes) va en un trozo aparte: solo se carga al abrir su sección.
const ManualView = lazy(() => import("../About/Manual"));

export function AdvancedSection() {
  return (
    <>
      <h4 className="st-subtitle">Diagnóstico</h4>
      <DiagnosticsPanel />
    </>
  );
}

export function ManualSection() {
  return (
    <Suspense
      fallback={
        <div className="st-manual-loading">
          <span className="spinner" />
        </div>
      }
    >
      <ManualView />
    </Suspense>
  );
}
