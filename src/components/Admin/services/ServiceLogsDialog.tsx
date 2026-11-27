// Registro de un servicio: las últimas 200 líneas de journalctl y, si se quiere, seguirlo en vivo (hasta
// 5 minutos). Con sudo se ve todo; sin él, lo que el sistema deje ver a tu usuario.
import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Pause, Radio, RefreshCw } from "lucide-react";
import { followLogs, readLogs, type LogTarget } from "../../../features/services";
import { clipboard } from "../../../lib/clipboard";
import { toast } from "../../../stores/toasts";
import { AdmModal } from "../../ui/AdmModal";
import { useAdmin } from "../context";

/** Tope de texto en pantalla al seguir en vivo (lo más viejo se va). */
const MAX_CHARS = 400_000;

export function ServiceLogsDialog({ target, me, onClose }: { target: LogTarget; me: string | null; onClose: () => void }) {
  const { sessionId, elevation, disabled } = useAdmin();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setText(await readLogs(sessionId, elevation, target, me));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId, elevation, target, me]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  const toggleFollow = () => {
    if (following) {
      stopRef.current?.();
      stopRef.current = null;
      setFollowing(false);
      return;
    }
    setFollowing(true);
    stopRef.current = followLogs(
      sessionId,
      elevation,
      target,
      (t) => setText((prev) => (prev + t).slice(-MAX_CHARS)),
      (err) => {
        stopRef.current = null;
        setFollowing(false);
        if (err) setError(err);
      },
    );
  };

  const name = target.unit.replace(/\.service$/, "");
  return (
    <AdmModal title={`Registro de ${name}${target.user ? ` (${target.user.name})` : ""}`} onClose={onClose} width="min(980px, 94vw)">
      <div className="modal-body svc-logs">
        <div className="svc-logs-bar">
          <button className="btn btn-sm" onClick={() => void load()} disabled={disabled || loading || following}>
            {loading ? <span className="spinner adm-spinner-btn" /> : <RefreshCw size={13} />} Últimas 200 líneas
          </button>
          <button className={`btn btn-sm${following ? " btn-primary" : ""}`} onClick={toggleFollow} disabled={disabled} title="Enseña lo nuevo según llega (se para solo a los 5 minutos)">
            {following ? <Pause size={13} /> : <Radio size={13} />} {following ? "Dejar de seguir" : "Seguir en vivo"}
          </button>
          <span className="adm-spacer" />
          <button
            className="icon-btn"
            onClick={() => clipboard.write(text).then(() => toast.success("Registro copiado"), (e) => toast.error("No se pudo copiar", String(e)))}
            disabled={!text}
            title="Copiar"
            aria-label="Copiar el registro"
          >
            <Copy size={14} />
          </button>
        </div>
        {!elevation && <div className="faint">Sin sudo puede que no se vea todo el registro.</div>}
        {error && <div className="adm-error" role="alert"><pre>{error}</pre></div>}
        <pre ref={preRef} className="svc-logs-text" aria-label="Registro">
          {text || (loading ? "Leyendo…" : "Sin líneas en el registro.")}
        </pre>
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </AdmModal>
  );
}
