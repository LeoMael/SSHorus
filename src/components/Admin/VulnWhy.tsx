// «Por qué sigue apareciendo» en el detalle de un hallazgo (texto de features/vulnscan/why.ts).
import type { Finding, Report } from "../../api/vulnscan";
import { whyStill } from "../../features/vulnscan";
import "./VulnFix.css";

export function VulnWhy({ report, f }: { report: Report; f: Finding }) {
  const lines = whyStill(report, f);
  if (!lines.length) return null;
  return (
    <details className="vs-d-sec vs-why">
      <summary>
        <h4>Por qué sigue apareciendo</h4>
      </summary>
      {lines.map((l, i) => (
        <p key={i} className="vs-d-note">
          {l}
        </p>
      ))}
    </details>
  );
}
