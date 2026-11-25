// Arreglo de «Ya existe un contenedor con ese nombre»: muestra qué contenedor estorba (y los del mismo
// origen que chocarán después), qué datos se conservan y cuáles se pueden perder, y lo reemplaza: lo para
// y lo borra (sin sus volúmenes) como su dueño y vuelve a lanzar la misma tarea.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { inspectSized, removeContainers, withOwner } from "../../features/containers";
import type { CtJob } from "../../features/containers/jobs";
import { RW_RISK_BYTES, assessReplace, composeOrigin, conflictTargets, parseContainerNames, type ReplaceAssessment } from "../../features/containers/nameConflict";
import { parseInspectList } from "../../features/containers/parseInspect";
import type { InspectSummary } from "../../features/containers";
import { formatBytes } from "../../lib/format";
import { AdmModal } from "../ui/AdmModal";
import { useCt } from "./context";
import "./ComposeJobs.css";

type Inspected = InspectSummary & { sizeRw: number | null; risk: ReplaceAssessment; later: boolean };

/** Fecha de `inspect` (ISO, con nanosegundos en Podman) en texto local. */
function createdText(iso: string): string {
  const d = new Date(iso.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(d.getTime()) ? iso || "—" : d.toLocaleString();
}

function OldContainer({ c }: { c: Inspected }) {
  const origin = composeOrigin(c.labels);
  const { risk } = c;
  return (
    <div className="ct-nc-item">
      <strong className="mono">{c.name}</strong>
      <dl>
        <dt>Id</dt>
        <dd className="mono">{c.id.slice(0, 12)}</dd>
        <dt>Imagen</dt>
        <dd className="mono">{c.image}</dd>
        <dt>Estado</dt>
        <dd>{c.state || "—"}</dd>
        <dt>Creado</dt>
        <dd>{createdText(c.created)}</dd>
        <dt>Origen</dt>
        <dd>{origin ? `proyecto «${origin.project}» de ${origin.tool}` : "creado a mano (sin etiquetas de Compose)"}</dd>
        <dt>Escrito dentro</dt>
        <dd>{c.sizeRw === null ? "no se sabe" : formatBytes(c.sizeRw)}</dd>
      </dl>
      {c.mounts.length === 0 ? (
        <div className="faint">Sin volúmenes ni carpetas montadas.</div>
      ) : (
        <ul className="ct-nc-mounts">
          {[...risk.named, ...risk.binds].map((m) => (
            <li key={m.destination} className="ct-nc-keep">
              {m.type === "bind" ? `Carpeta del servidor ${m.source}` : `Volumen «${m.name}»`} → <span className="mono">{m.destination}</span>: se conserva
            </li>
          ))}
          {risk.anonymous.map((m) => (
            <li key={m.destination} className="ct-bad-text">
              Volumen anónimo → <span className="mono">{m.destination}</span>: no se borra, pero el contenedor nuevo no lo usará
            </li>
          ))}
          {c.mounts
            .filter((m) => m.type !== "bind" && m.type !== "volume")
            .map((m) => (
              <li key={m.destination} className="faint">
                {m.type} → <span className="mono">{m.destination}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

export function NameConflictDialog({ job, onClose }: { job: CtJob; onClose: () => void }) {
  const ct = useCt();
  const [items, setItems] = useState<Inspected[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withLater, setWithLater] = useState(true);
  const [accept, setAccept] = useState(false);
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setItems(null);
      setError(null);
      // Nombres fijos del compose: los contenedores viejos con esos nombres también chocarían después.
      const cfg = job.configCmd ? await ct.run([withOwner(job.configCmd, job.owner)], 30) : null;
      const expected = cfg?.ok ? parseContainerNames(cfg.result?.stdout ?? "") : [];
      // La lista de contenedores sirve solo si es la de ese dueño (o la de «Todos», con dueño en cada fila).
      const listed = ct.allOwners || ct.newOwner === job.owner ? (ct.res.containers.data ?? []) : [];
      const { now, later } = conflictTargets(job.conflicts, listed, job.owner, expected);
      // Los que no están en la lista (lista vieja) se buscan por su id o nombre.
      const missing = job.conflicts.filter((k) => !now.some((c) => c.name === k.name)).map((k) => k.id ?? k.name);
      const refs = [...new Set([...now.map((c) => c.id), ...missing, ...later.map((c) => c.id)])];
      const r = await ct.run([withOwner(inspectSized(ct.engine, refs), job.owner)], 60);
      if (!alive) return;
      const list = r.result ? parseInspectList(r.result.stdout) : [];
      if (!list.length) {
        setError(r.error ?? "No se pudo leer el contenedor que estorba (puede que ya no exista: vuelve a intentar la tarea)");
        return;
      }
      const laterIds = new Set(later.map((c) => c.id));
      setItems(list.map((s) => ({ ...s, risk: assessReplace(s), later: [...laterIds].some((id) => s.id.startsWith(id) || id.startsWith(s.id)) })));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, seq]);

  const chosen = useMemo(() => (items ?? []).filter((c) => !c.later || withLater), [items, withLater]);
  const risky = chosen.filter((c) => c.risk.risky);
  const rm = withOwner(removeContainers(ct.engine, chosen.map((c) => c.id.slice(0, 12)), { force: true, volumes: false }), job.owner);
  const canRun = chosen.length > 0 && (!risky.length || accept);

  const replace = () => {
    if (!canRun) return;
    ct.startJob({
      title: job.title,
      detail: job.detail,
      key: job.key,
      owner: job.owner,
      cmds: [rm, ...job.cmds],
      success: job.success,
      configCmd: job.configCmd,
      onFinished: () => void ct.reload("containers"),
    });
    onClose();
  };

  const nowItems = (items ?? []).filter((c) => !c.later);
  const laterItems = (items ?? []).filter((c) => c.later);
  return (
    <AdmModal title="Ya existe un contenedor con ese nombre" onClose={onClose} width={680}>
      <div className="modal-body ct-review">
        <div className="dialog-message">
          Compose necesita crear un contenedor con un nombre que ya usa otro contenedor viejo que no reconoce como suyo (suele pasar si el proyecto se levantó
          antes con otra herramienta, como podman-compose, o a mano). Se puede reemplazar: se para y se borra el contenedor viejo y se vuelve a lanzar la tarea.
        </div>
        {!items && !error && (
          <div className="ct-progress-line">
            <span className="spinner ct-spinner-sm" /> Leyendo el contenedor que estorba…
          </div>
        )}
        {error && (
          <div className="ct-error" role="alert">
            <AlertTriangle size={14} />
            <pre>{error}</pre>
          </div>
        )}
        {nowItems.map((c) => (
          <OldContainer key={c.id} c={c} />
        ))}
        {laterItems.length > 0 && (
          <>
            <label className="checkbox">
              <input type="checkbox" checked={withLater} onChange={(e) => setWithLater(e.target.checked)} />
              <span>
                Reemplazar también {laterItems.length === 1 ? "este, que chocará después" : `estos ${laterItems.length}, que chocarán después`} (mismo origen y un nombre
                del compose)
              </span>
            </label>
            {withLater && laterItems.map((c) => <OldContainer key={c.id} c={c} />)}
          </>
        )}
        {items && (
          <div className="ct-warn">Los volúmenes con nombre y las carpetas del servidor se conservan: el contenedor nuevo los vuelve a usar. No se borra ningún volumen.</div>
        )}
        {risky.length > 0 && (
          <div className="ct-nc-risk" role="alert">
            <strong>Se pueden perder datos:</strong>
            <ul>
              {risky.map((c) => (
                <li key={c.id}>
                  <span className="mono">{c.name}</span>:{" "}
                  {[
                    c.risk.unsafeDataDirs.length ? `sus datos (${c.risk.unsafeDataDirs.join(", ")}) no están en un volumen con nombre ni en una carpeta del servidor` : "",
                    c.risk.anonymous.length ? `usa ${c.risk.anonymous.length === 1 ? "un volumen anónimo" : `${c.risk.anonymous.length} volúmenes anónimos`} (quedan aparte, sin usar)` : "",
                    (c.sizeRw ?? 0) >= RW_RISK_BYTES ? `tiene ${formatBytes(c.sizeRw ?? 0)} escritos dentro del contenedor, que se borran con él` : "",
                  ]
                    .filter(Boolean)
                    .join("; ")}
                </li>
              ))}
            </ul>
            <label className="checkbox">
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
              <span>Entiendo que se pueden perder esos datos (haz antes una copia si los necesitas)</span>
            </label>
          </div>
        )}
        {chosen.length > 0 && (
          <>
            <div className="ct-review-label">Se ejecutará (y después, la misma tarea otra vez):</div>
            <pre className="ct-cmd">{ct.render(rm)}</pre>
          </>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn ct-footer-left" onClick={() => setSeq((n) => n + 1)} disabled={!items && !error}>
          <RefreshCw size={13} /> Volver a leer
        </button>
        <button className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button className={risky.length ? "btn btn-danger" : "btn btn-primary"} onClick={replace} disabled={!canRun}>
          Reemplazar el contenedor viejo y volver a intentarlo
        </button>
      </div>
    </AdmModal>
  );
}
