// «Explicar con IA» de la auditoría: enseña el texto EXACTO antes de enviarlo (sin usuarios, IP, rutas ni
// comandos) y guarda la respuesta junto al informe.
import { useMemo, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { errorMessage, isApiError } from "../../../api/core";
import { audit, type AuditReport } from "../../../api/audit";
import { newExecId } from "../../../api/snippets";
import { ai } from "../../../api/vulnscan";
import { buildAuditAiMessages } from "../../../features/audit";
import { useSettings } from "../../../stores/settings";
import { AdmModal } from "../../ui/AdmModal";

export function AuditAiDialog({
  report,
  profileId,
  onDone,
  onClose,
}: {
  report: AuditReport;
  profileId: string;
  onDone: (r: AuditReport) => void;
  onClose: () => void;
}) {
  const settings = useSettings((s) => s.settings.ai);
  const [includeOk, setIncludeOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef<string | null>(null);
  const messages = useMemo(() => buildAuditAiMessages(report, includeOk), [report, includeOk]);
  const preview = messages.map((m) => `── ${m.role === "system" ? "Instrucciones (system)" : "Mensaje (user)"} ──\n${m.content}`).join("\n\n");

  const send = async () => {
    const id = newExecId();
    reqId.current = id;
    setBusy(true);
    setError(null);
    try {
      const r = await ai.chat(messages, id);
      const saved = await audit.setAi(profileId, report.id, { model: r.model, createdAt: new Date().toISOString(), text: r.text });
      onDone(saved);
      onClose();
    } catch (e) {
      if (!isApiError(e, "Canceled")) setError(errorMessage(e));
    } finally {
      reqId.current = null;
      setBusy(false);
    }
  };
  const cancel = () => {
    if (reqId.current) void ai.cancel(reqId.current);
  };

  return (
    <AdmModal title="Explicar con IA: esto es lo que se enviará" onClose={busy ? cancel : onClose} width={760}>
      <div className="modal-body vs-ai-body">
        <p className="faint">
          A <span className="mono">{settings.baseUrl || "(sin URL)"}</span> con <span className="mono">{settings.model || "(sin modelo)"}</span>. Solo notas
          y títulos: sin nombre del servidor, IP, usuarios, rutas ni comandos.
        </p>
        <label className="checkbox">
          <input type="checkbox" checked={includeOk} disabled={busy} onChange={(e) => setIncludeOk(e.target.checked)} />
          Incluir también lo que está bien
        </label>
        <pre className="mono vs-ai-preview" tabIndex={0} aria-label="Texto exacto que se enviará">
          {preview}
        </pre>
        {error && (
          <div className="field-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="modal-footer">
        {busy ? (
          <button className="btn" onClick={cancel}>
            <Square size={13} /> Cancelar
          </button>
        ) : (
          <button className="btn" onClick={onClose}>
            Cerrar
          </button>
        )}
        <button className="btn btn-primary" onClick={() => void send()} disabled={busy}>
          {busy ? <span className="spinner adm-spinner-btn" /> : <Send size={13} />}
          {busy ? "Esperando a la IA…" : report.ai ? "Enviar de nuevo" : "Enviar"}
        </button>
      </div>
    </AdmModal>
  );
}
