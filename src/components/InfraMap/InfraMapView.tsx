// Lienzo del mapa de infraestructura: SVG propio (sin dependencias) con disposición por capas, zoom,
// desplazamiento, ajustar a la pantalla, minimapa, filtros, listas largas plegadas, leyenda, panel de
// detalles y exportar.
import { useCallback, useMemo, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { Network } from "lucide-react";
import { buildGraph } from "../../features/infra/graph";
import { filterGraph, graphOwners, LAYERS, type NavTarget, type ServerSnapshot } from "../../features/infra/graphTypes";
import { foldGraph, MORE_PREFIX, type PlacedNode } from "../../features/infra";
import { layoutGraph } from "../../features/infra/layout";
import { zoomPercent } from "../../features/infra/viewport";
import { toMermaid } from "../../features/infra/text";
import { exportMap, type ExportFormat } from "./exportMap";
import { FOLD_PREFIX } from "./MapScope";
import { MapLegend } from "./MapLegend";
import { MapMoreCard, MapNodeCard } from "./MapNodeCard";
import { MiniMap, ZoomControls } from "./MapOverlays";
import { MapGroupBox, MapServerBox } from "./MapServerBox";
import { MapToolbar } from "./MapToolbar";
import { NodeDetails } from "./NodeDetails";
import { useMapCanvas } from "./useMapCanvas";
import { useMapScope } from "./useMapScope";
import { useMapViewport } from "./useMapViewport";
import "./InfraMap.css";
import "./MapCanvas.css";

const NO_KEYS: ReadonlySet<string> = new Set();

export function InfraMapView({
  snapshots,
  loading,
  updatedAt,
  cacheKey,
  onRefresh,
  onNav,
  name,
  extraTools,
}: {
  snapshots: ServerSnapshot[] | null;
  /** Leyendo (con datos guardados en pantalla, la lectura va en segundo plano). */
  loading: boolean;
  /** Momento de la lectura mostrada (null si no hay o es una vista previa). */
  updatedAt: number | null;
  /** Clave del mapa en la caché: la vista, la selección y los filtros se recuerdan al salir. */
  cacheKey: string;
  onRefresh: () => void;
  /** «Ir a…» desde el panel de detalles. */
  onNav?: (serverId: string, target: NavTarget) => void;
  /** Nombre para los archivos exportados. */
  name: string;
  extraTools?: ReactNode;
}) {
  const { hideLocal, setHideLocal, hideSystem, setHideSystem, owners, setOwners, selected, setSelected, miniOn, setMiniOn, refitKey } = useMapCanvas(cacheKey);
  /** Columnas largas desplegadas a mano (por clave de columna). */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(NO_KEYS);

  const full = useMemo(() => (snapshots ? buildGraph(snapshots) : null), [snapshots]);
  const scope = useMapScope(snapshots, full);
  const scoped = scope.graph;
  // En «Lo mío» no hay que elegir usuarios: los filtros por usuario solo valen para «Todo el servidor».
  const ownerFilter = scope.anyMine ? null : owners;
  const allOwners = useMemo(() => (scoped && !scope.anyMine ? graphOwners(scoped) : []), [scoped, scope.anyMine]);
  const graph = useMemo(() => (scoped ? filterGraph(scoped, { hideLocal, hideSystem, owners: ownerFilter }) : null), [scoped, hideLocal, hideSystem, ownerFilter]);
  const folded = useMemo(() => (graph ? foldGraph(graph, expanded) : null), [graph, expanded]);
  const shown = folded?.graph ?? null;
  const layout = useMemo(() => (shown ? layoutGraph(shown) : null), [shown]);
  const sel = selected ? (graph?.nodes.find((n) => n.id === selected) ?? null) : null;
  const related = useMemo(() => {
    if (!sel || !shown) return null;
    const s = new Set([sel.id]);
    for (const e of shown.edges) {
      if (e.from === sel.id) s.add(e.to);
      if (e.to === sel.id) s.add(e.from);
    }
    return s;
  }, [sel, shown]);
  const hiddenCount = folded ? [...folded.folds.values()].reduce((a, f) => a + f.ids.length, 0) : 0;
  const expand = useCallback(
    (id: string) => {
      const f = folded?.folds.get(id);
      if (f) setExpanded((cur) => new Set([...cur, f.key]));
    },
    [folded],
  );

  // ───────── Zoom y desplazamiento ─────────
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const { wrapRef, view, size, zoomIn, zoomOut, fit, center, canvasProps } = useMapViewport({
    content: layout,
    memoryKey: cacheKey,
    refitKey: `${refitKey}|${scope.key}`,
    onClick: (id) => {
      if (id?.startsWith(FOLD_PREFIX)) scope.showAll(id.slice(FOLD_PREFIX.length));
      else if (id?.startsWith(MORE_PREFIX)) expand(id);
      else setSelected(id);
    },
    onEscape: () => setSelected(null),
  });
  const selPlaced = sel ? layout?.nodes.get(sel.id) : undefined;
  const centerSel = selPlaced ? () => center(selPlaced.x + selPlaced.w / 2, selPlaced.y + selPlaced.h / 2) : undefined;

  const activate = useCallback((id: string) => (id.startsWith(MORE_PREFIX) ? expand(id) : setSelected(id)), [expand, setSelected]);
  const viewRef = useRef({ view, size });
  viewRef.current = { view, size };
  const onFocusNode = useCallback(
    (p: PlacedNode, e: FocusEvent<SVGGElement>) => {
      // Con el teclado, si el nodo queda fuera de la vista se centra en él.
      const { view: v, size: s } = viewRef.current;
      const sx = p.x * v.k + v.x;
      const sy = p.y * v.k + v.y;
      const out = sx < 0 || sy < 0 || sx + p.w * v.k > s.w || sy + p.h * v.k > s.h;
      if (out && e.currentTarget.matches(":focus-visible")) center(p.x + p.w / 2, p.y + p.h / 2);
    },
    [center],
  );

  const doExport = (f: ExportFormat) => {
    if (!svgRef.current || !contentRef.current || !layout || !graph) return;
    void exportMap(f, { name, svg: svgRef.current, content: contentRef.current, width: layout.width, height: layout.height, mermaid: () => toMermaid(graph) });
  };

  const toggleOwner = (o: string) => {
    setOwners((cur) => {
      const s = new Set(cur ?? allOwners);
      if (s.has(o)) s.delete(o);
      else s.add(o);
      return s.size === allOwners.length ? null : s;
    });
  };

  const notes = scope.notes.other;

  return (
    <div className="im-root">
      <MapToolbar
        scope={scope}
        hideLocal={hideLocal}
        setHideLocal={setHideLocal}
        hideSystem={hideSystem}
        setHideSystem={setHideSystem}
        allOwners={allOwners}
        owners={owners}
        onAllOwners={() => setOwners(null)}
        onToggleOwner={toggleOwner}
        folded={{
          hidden: hiddenCount,
          expanded: expanded.size,
          onExpandAll: () => setExpanded((cur) => new Set([...cur, ...[...(folded?.folds.values() ?? [])].map((f) => f.key)])),
          onCollapse: () => setExpanded(NO_KEYS),
        }}
        miniOn={miniOn}
        onToggleMini={() => setMiniOn((m) => !m)}
        canExport={!!layout}
        onExport={doExport}
        updatedAt={updatedAt}
        loading={loading}
        onRefresh={onRefresh}
        extraTools={extraTools}
      />
      {scope.notes.scope.length > 0 && (
        <div className="im-scope-note" role="status">
          {scope.notes.scope.map((n, i) => (
            <span key={i}>{n}</span>
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <div className="im-notes" role="status">
          {notes.slice(0, 3).map((n, i) => (
            <span key={i}>{n}</span>
          ))}
        </div>
      )}
      <div className="im-body">
        <div ref={wrapRef} className="im-canvas" {...canvasProps} tabIndex={0} aria-label="Mapa de infraestructura">
          {!layout || !shown || !folded ? (
            <div className="empty-state im-empty">
              {loading ? <span className="spinner" /> : <Network size={22} />}
              <div>{loading ? "Leyendo el servidor…" : "Sin datos"}</div>
            </div>
          ) : (
            <svg ref={svgRef} className="im-svg" width={size.w} height={size.h}>
              <defs>
                <marker id="im-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className="im-arrow" />
                </marker>
                <marker id="im-arrow-x" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className="im-arrow-x" />
                </marker>
              </defs>
              <g ref={contentRef} transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                {layout.columns.map((c) => (
                  <text key={c.layer} x={c.x + 4} y={24} className="im-col">
                    {LAYERS[c.layer]}
                  </text>
                ))}
                {layout.servers.map((s) => (
                  <MapServerBox key={s.id} box={s} srv={shown.servers.find((x) => x.id === s.id)!} />
                ))}
                {layout.groups.map((g, i) => (
                  <MapGroupBox key={i} g={g} />
                ))}
                {layout.edges.map((e) => {
                  const near = related ? related.has(e.edge.from) && related.has(e.edge.to) : null;
                  return (
                    <g key={e.edge.id} className={`im-edge im-e-${e.edge.kind}${near === false ? " dim" : near ? " hot" : ""}`}>
                      <path d={e.path} markerEnd={`url(#${e.edge.kind === "cross" ? "im-arrow-x" : "im-arrow"})`} />
                      {e.edge.label && (
                        <text x={e.lx} y={e.ly - 4} textAnchor="end" className="im-edge-label">
                          {e.edge.label}
                        </text>
                      )}
                    </g>
                  );
                })}
                {[...layout.nodes.values()].map((p) => {
                  const fold = folded.folds.get(p.node.id);
                  if (fold) return <MapMoreCard key={p.node.id} p={p} names={p.node.details.map(([k]) => k)} onActivate={activate} />;
                  return <MapNodeCard key={p.node.id} p={p} selected={selected === p.node.id} dim={!!related && !related.has(p.node.id)} onActivate={activate} onFocusNode={onFocusNode} />;
                })}
              </g>
            </svg>
          )}
          {layout && miniOn && <MiniMap layout={layout} view={view} size={size} onCenter={center} />}
          {layout && <ZoomControls percent={zoomPercent(view.k)} onIn={zoomIn} onOut={zoomOut} onFit={fit} onCenterSelected={centerSel} />}
          <MapLegend />
        </div>
        {sel && (
          <NodeDetails
            node={sel}
            serverName={graph?.servers.find((x) => x.id === sel.server)?.name ?? null}
            snapshot={snapshots?.find((x) => x.id === sel.server) ?? null}
            onNav={onNav}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}
