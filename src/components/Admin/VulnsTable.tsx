// Piezas auxiliares de VulnsTab: filas, columnas, icono de fase y barra de filtros.
import type { KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronRight, CircleSlash, Loader2, Search, TriangleAlert, X } from "lucide-react";
import type { Finding, Report, Severity } from "../../api/vulnscan";
import type { Phase } from "../../features/vulnscan";
import type { Column } from "./VirtualTable";
import { originLabel, SEV_LABEL, SEV_ORDER, SevTag, SOURCE_LABEL } from "./vulnUi";

export const KERNEL_KEY = "__kernel__";

export type VulnRow =
  | { kind: "f"; f: Finding; child: boolean }
  | { kind: "kernel"; items: Finding[]; worst: Severity; open: boolean };

export function vulnRowKey(r: VulnRow): string {
  return r.kind === "kernel" ? KERNEL_KEY : r.f.key;
}

export function matchesVuln(f: Finding, q: string): boolean {
  if (!q) return true;
  const hay = [f.id, f.package, f.installed, f.fixed ?? "", f.summary ?? "", ...f.aliases, ...f.advisories, ...f.binaries].join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export function PhaseIcon({ p }: { p: Phase }) {
  switch (p.status) {
    case "ok":
      return <Check size={13} className="vs-ph-ok" />;
    case "running":
      return <Loader2 size={13} className="adm-spin" />;
    case "warn":
      return <TriangleAlert size={13} className="vs-ph-warn" />;
    case "error":
      return <TriangleAlert size={13} className="vs-ph-error" />;
    case "skipped":
      return <CircleSlash size={13} className="faint" />;
    default:
      return <span className="vs-ph-dot" />;
  }
}

export function buildVulnColumns(report: Report | null | undefined, toggleKernel: () => void): Column<VulnRow>[] {
  return [
    {
      key: "sev",
      label: "Gravedad",
      width: "110px",
      render: (r) =>
        r.kind === "kernel" ? (
          <span className="adm-cell-flex">
            <button
              className="icon-btn adm-row-btn vs-expander"
              aria-expanded={r.open}
              aria-label={r.open ? "Plegar las del kernel" : "Ver las del kernel una por una"}
              onClick={(e) => {
                e.stopPropagation();
                toggleKernel();
              }}
              tabIndex={-1}
            >
              {r.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            <SevTag s={r.worst} />
          </span>
        ) : (
          <span className={r.child ? "vs-child" : undefined}>
            <SevTag s={r.f.severity} />
          </span>
        ),
    },
    {
      key: "id",
      label: "CVE / aviso",
      width: "minmax(150px, 1fr)",
      render: (r) =>
        r.kind === "kernel" ? (
          <strong>Kernel: {r.items.length} vulnerabilidades</strong>
        ) : (
          <span className="adm-cell-flex">
            <span className="mono adm-ellipsis">{r.f.id}</span>
            {r.f.unimportant && <span className="adm-tag vs-tag-muted" title="La distro lo considera sin importancia">sin importancia</span>}
          </span>
        ),
      title: (r) => (r.kind === "kernel" ? "Actualiza el kernel y reinicia" : [r.f.id, ...r.f.advisories, r.f.summary ?? ""].filter(Boolean).join("\n")),
    },
    {
      key: "pkg",
      label: "Paquete",
      width: "minmax(120px, 1fr)",
      render: (r) =>
        r.kind === "kernel" ? (
          <span className="faint">actualiza el kernel y reinicia</span>
        ) : (
          <span className="mono adm-ellipsis">{r.f.package}</span>
        ),
      title: (r) => (r.kind === "kernel" ? "" : r.f.binaries.join(", ") || r.f.package),
    },
    {
      key: "ver",
      label: "Instalada → arreglada",
      width: "minmax(170px, 1.3fr)",
      render: (r) => {
        if (r.kind === "kernel") return <span className="faint">{r.items.filter((x) => x.hasFix).length} con arreglo</span>;
        const f = r.f;
        return (
          <span className="mono adm-ellipsis">
            {f.installed || "?"} →{" "}
            {f.fixed ? <span className="vs-fixed">{f.fixed}</span> : f.hasFix ? <span className="vs-fixed">sí</span> : <span className="faint">sin arreglo</span>}
          </span>
        );
      },
      title: (r) => (r.kind === "kernel" ? "" : `${r.f.installed} → ${r.f.fixed ?? (r.f.hasFix ? "hay arreglo" : "sin arreglo")}`),
    },
    {
      key: "origin",
      label: "Origen",
      width: "minmax(110px, 1fr)",
      render: (r) => <span className="adm-ellipsis">{r.kind === "kernel" ? "Sistema" : originLabel(report!, r.f.target)}</span>,
      title: (r) => (r.kind === "kernel" ? "Sistema" : originLabel(report!, r.f.target)),
    },
    {
      key: "src",
      label: "Fuente",
      width: "100px",
      render: (r) => (r.kind === "kernel" ? "" : <span className="faint">{r.f.sources.map((s) => SOURCE_LABEL[s]).join(", ")}</span>),
    },
  ];
}

export function VulnsFilterBar({
  report,
  query,
  setQuery,
  severity,
  setSeverity,
  origin,
  setOrigin,
  onlyFix,
  setOnlyFix,
  unimportantCount,
  showUnimportant,
  setShowUnimportant,
}: {
  report: Report;
  query: string;
  setQuery: (q: string) => void;
  severity: Severity | "all";
  setSeverity: (s: Severity | "all") => void;
  origin: string;
  setOrigin: (o: string) => void;
  onlyFix: boolean;
  setOnlyFix: (v: boolean) => void;
  unimportantCount: number;
  showUnimportant: boolean;
  setShowUnimportant: (v: boolean) => void;
}) {
  return (
    <div className="adm-toolbar">
      <div className="adm-search adm-search-wide">
        <Search size={13} />
        <input
          className="input"
          placeholder="CVE, paquete, versión o texto"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            }
          }}
          aria-label="Buscar vulnerabilidades"
        />
        {query && (
          <button className="icon-btn adm-search-clear" onClick={() => setQuery("")} aria-label="Limpiar búsqueda">
            <X size={12} />
          </button>
        )}
      </div>
      <select className="input vs-select" value={severity} onChange={(e) => setSeverity(e.target.value as Severity | "all")} aria-label="Gravedad">
        <option value="all">Todas las gravedades</option>
        {SEV_ORDER.map((s) => (
          <option key={s} value={s}>
            {SEV_LABEL[s]}
          </option>
        ))}
      </select>
      <select className="input vs-select" value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Origen">
        <option value="all">Todo (sistema, programas e imágenes)</option>
        {report.targets.map((t) => (
          <option key={t.key} value={t.key}>
            {t.kind === "system" ? "Sistema" : t.kind === "runtime" ? "Programas sueltos" : t.label}
            {t.error ? " (con avisos)" : ""}
          </option>
        ))}
      </select>
      <label className="checkbox">
        <input type="checkbox" checked={onlyFix} onChange={(e) => setOnlyFix(e.target.checked)} />
        Solo con arreglo
      </label>
      {unimportantCount > 0 && (
        <label className="checkbox" title="Debian marca algunas como «unimportant»: no suelen afectar en la práctica">
          <input type="checkbox" checked={showUnimportant} onChange={(e) => setShowUnimportant(e.target.checked)} />
          Mostrar lo que la distro considera sin importancia ({unimportantCount})
        </label>
      )}
    </div>
  );
}
