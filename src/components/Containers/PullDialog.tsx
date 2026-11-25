// Descargar (o actualizar) una imagen: se lanza como tarea en segundo plano, con la salida en vivo aquí
// mismo; se puede cerrar la ventana y seguirla en «Tareas».
import { useState } from "react";
import { Download, TerminalSquare } from "lucide-react";
import { pullImage, validateImage, withOwner } from "../../features/containers";
import { useJobs } from "../../stores/jobs";
import { AdmModal } from "../ui/AdmModal";
import { useCt } from "./context";
import { JobPanel } from "../Jobs/JobPanel";

export function PullDialog({ initial, owner, onClose }: { initial: string; owner?: string; onClose: () => void }) {
  const ct = useCt();
  const who = owner ?? ct.newOwner ?? undefined;
  const [ref, setRef] = useState(initial);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobs((s) => (jobId ? (s.jobs.find((j) => j.id === jobId) ?? null) : null));
  const busy = job?.status === "running";

  const v = ref.trim();
  const invalid = v ? validateImage(v) : null;
  const cmd = withOwner({ ...pullImage(ct.engine, v || "<imagen>"), mergeStderr: true }, who);
  const asWho = ct.allOwners || (who && who !== "self") ? ` (como ${ct.ownerLabel(who)})` : "";

  const pull = () => {
    if (!v || invalid || busy) return;
    setJobId(
      ct.startJob({
        title: "Descargar imagen",
        detail: `${v}${asWho}`,
        key: `pull|${who ?? ""}|${v}`,
        owner: who ?? "self",
        cmds: [cmd],
        success: "Imagen descargada",
        onFinished: (j) => {
          if (j.status === "done") void ct.reload("images", "df");
        },
      }),
    );
  };

  return (
    <AdmModal title={`Descargar imagen${asWho}`} onClose={onClose} width={680}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          pull();
        }}
      >
        <div className="modal-body">
          <label className="field">
            <span>Imagen (registro/nombre:etiqueta)</span>
            <input
              className="input mono"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="docker.io/library/nginx:alpine"
              autoFocus
              spellCheck={false}
              disabled={busy}
            />
          </label>
          {invalid && <div className="field-error">{invalid}</div>}
          {ct.engine === "podman" && v && !v.includes("/") && (
            <div className="ct-hint-line faint">Consejo: en Podman usa el nombre completo (docker.io/library/{v}) para no depender de los registros configurados.</div>
          )}
          <pre className="ct-cmd">{ct.render(cmd)}</pre>
          {job && <JobPanel job={job} compact />}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn ct-footer-left"
            disabled={!v || !!invalid || busy}
            title="Ver el progreso detallado en la terminal"
            onClick={() => {
              if (ct.toTerminal(withOwner(pullImage(ct.engine, v), who), true)) onClose();
            }}
          >
            <TerminalSquare size={13} /> En la terminal
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {busy ? "Cerrar (sigue en segundo plano)" : job ? "Cerrar" : "Cancelar"}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!v || !!invalid || busy}>
            {busy ? <span className="spinner ct-spinner-sm" /> : <Download size={13} />} Descargar
          </button>
        </div>
      </form>
    </AdmModal>
  );
}
