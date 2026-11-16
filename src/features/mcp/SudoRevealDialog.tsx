// Diálogo de `request_sudo_password`: la IA pide VER la contraseña de sudo de un servidor.
// Es una petición de permiso del motor (como ApprovalDialog) con su propio diálogo: servidor, motivo que
// da la IA y el aviso de que la contraseña quedará en la conversación. Sin «Permitir siempre» ni «Aceptar
// automáticamente»; sin respuesta a tiempo, el motor lo deniega. Si se permite, el motor pide la contraseña
// (petición `sudo-reveal`): la guardada o la de memoria, o el SudoDialog de siempre para escribirla.
import { useState } from "react";
import { AlertTriangle, Bot, KeyRound } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { mcp, type McpApprovalRequest, type McpDecision } from "../../api/mcp";
import { toast } from "../../stores/toasts";
import { useMcp } from "./store";
import { useSecondsLeft } from "./useSecondsLeft";
import "./Mcp.css";

export const SUDO_REVEAL_TOOL = "request_sudo_password";

export function SudoRevealDialog({ req, total }: { req: McpApprovalRequest; total: number }) {
  const left = useSecondsLeft(req.expiresAt);
  const [busy, setBusy] = useState(false);
  const who = req.client ? `La IA (${req.client})` : "La IA";

  const answer = async (d: McpDecision) => {
    setBusy(true);
    try {
      await mcp.reply(req.id, d);
    } catch (e) {
      toast.error("No se pudo enviar la respuesta", e);
    } finally {
      useMcp.setState((s) => ({ approvals: s.approvals.filter((a) => a.id !== req.id) }));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={total > 1 ? `La IA pide la contraseña de sudo (1 de ${total})` : "La IA pide la contraseña de sudo"}
      onClose={() => void answer("deny")}
      width="min(560px, 94vw)"
      footer={
        <>
          <span className="mcp-countdown" aria-live="polite">
            Se denegará solo en {left} s
          </span>
          <button className="btn" onClick={() => void answer("deny")} disabled={busy} autoFocus>
            Denegar
          </button>
          <button className="btn btn-danger" onClick={() => void answer("once")} disabled={busy}>
            <KeyRound size={13} /> Dar la contraseña a la IA
          </button>
        </>
      }
    >
      <div className="mcp-ask">
        <p className="mcp-ask-lead">
          <Bot size={16} /> {who} quiere ver la contraseña de sudo de <strong>{req.serverName}</strong>. Su motivo:
        </p>
        <pre className="mcp-command">{req.command}</pre>
        <div className="mcp-danger" role="alert">
          <AlertTriangle size={16} />
          <div>
            <strong>La contraseña quedará en la conversación con la IA.</strong> Para ejecutar comandos con sudo no hace
            falta: SSHorus la pone sin que la IA la vea. Permítelo solo si de verdad la necesita.
          </div>
        </div>
        <p className="mcp-ask-hint">
          Si no está guardada, SSHorus te la pedirá a continuación. Queda anotado en «Actividad del asistente» (sin la
          contraseña).
        </p>
      </div>
    </Modal>
  );
}
