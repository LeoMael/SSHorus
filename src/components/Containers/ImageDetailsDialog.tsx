// Detalles de una imagen: `image inspect` en palabras simples (sistema, arranque, puertos, variables,
// etiquetas) y qué contenedores la usan (con su estado y un atajo para inspeccionarlos).
import { useEffect, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import {
  STATE_LABEL,
  imageLabel,
  inspectImage,
  parseImageInspect,
  stateTone,
  usersOf,
  withOwner,
  type ImageDetails,
  type ImageInfo,
} from "../../features/containers";
import { formatBytes } from "../../lib/format";
import { AdmModal } from "../ui/AdmModal";
import { useCt } from "./context";

function fmtDate(s: string): string {
  const t = Date.parse(s);
  return s && Number.isFinite(t) ? new Date(t).toLocaleString() : s || "—";
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{value}</dd>
    </>
  );
}

export function ImageDetailsDialog({ image, onClose }: { image: ImageInfo; onClose: () => void }) {
  const ct = useCt();
  const [d, setD] = useState<ImageDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const users = usersOf(image, ct.res.containers.data ?? []);

  useEffect(() => {
    let alive = true;
    void ct.run([withOwner(inspectImage(ct.engine, image.id), image.owner)], 30).then((r) => {
      if (!alive) return;
      const parsed = r.ok && r.result ? parseImageInspect(r.result.stdout) : null;
      if (parsed) setD(parsed);
      else setError(r.error ?? "La respuesta no es JSON válido");
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.id, image.owner]);

  const who = ct.allOwners ? ` (${ct.ownerLabel(image.owner)})` : "";
  const labels = Object.entries(d?.labels ?? {});
  return (
    <AdmModal title={`Imagen ${imageLabel(image)}${who}`} onClose={onClose} width={760}>
      <div className="modal-body ct-inspect">
        <section className="ct-sec">
          <h4 className="section-label">
            Contenedores que la usan <span className="ct-count">{Math.max(users.length, image.containers ?? 0)}</span>
          </h4>
          {users.length ? (
            <ul className="ct-list">
              {users.map((c) => (
                <li key={c.id}>
                  <span className={`ct-dot ct-${stateTone(c.state)}`} /> <strong>{c.name}</strong> <span className="faint">{STATE_LABEL[c.state]}</span>{" "}
                  <button className="icon-btn" title="Inspeccionar el contenedor" aria-label={`Inspeccionar ${c.name}`} onClick={() => ct.openInspect(c)}>
                    <Search size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="faint ct-small">
              {image.containers ? `El motor dice que la usan ${image.containers}, pero no salen en la lista.` : "Ninguno: se puede borrar sin problema."}
            </div>
          )}
        </section>
        {error && (
          <div className="ct-error ct-error-inline" role="alert">
            <AlertTriangle size={14} />
            <pre>{error}</pre>
          </div>
        )}
        {!d && !error && (
          <div className="empty-state">
            <span className="spinner" />
          </div>
        )}
        {d && (
          <section className="ct-sec">
            <h4 className="section-label">General</h4>
            <dl className="ct-kv">
              <Row label="Nombres" value={d.tags.join(", ") || "<sin nombre>"} mono />
              <Row label="ID" value={d.id} mono />
              <Row label="Creada" value={fmtDate(d.created)} />
              <Row label="Tamaño" value={d.size !== null ? formatBytes(d.size) : ""} />
              <Row label="Sistema" value={[d.os, d.arch].filter(Boolean).join(" / ")} />
              <Row label="Usuario" value={d.user} mono />
              <Row label="Arranca con" value={[...d.entrypoint, ...d.cmd].join(" ")} mono />
              <Row label="Carpeta de trabajo" value={d.workdir} mono />
              <Row label="Puertos" value={d.ports.join(", ")} mono />
              <Row label="Resúmenes" value={d.digests.join("\n")} mono />
            </dl>
          </section>
        )}
        {d && d.env.length > 0 && (
          <section className="ct-sec">
            <h4 className="section-label">
              Variables por defecto <span className="ct-count">{d.env.length}</span>
            </h4>
            <pre className="ct-cmd ct-cmd-sm">{d.env.join("\n")}</pre>
          </section>
        )}
        {labels.length > 0 && (
          <section className="ct-sec">
            <h4 className="section-label">
              Etiquetas <span className="ct-count">{labels.length}</span>
            </h4>
            <pre className="ct-cmd ct-cmd-sm">{labels.map(([k, v]) => `${k}=${v}`).join("\n")}</pre>
          </section>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </AdmModal>
  );
}
