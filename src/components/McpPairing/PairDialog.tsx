// Diálogo «Conectar un asistente»: una IA ejecutó `sshorus-mcp pair` y pide usar SSHorus. Muestra lo que vio
// el puente (programa, pid, carpeta), deja elegir los permisos por servidor y espera Aceptar o Rechazar.
// Sin respuesta a tiempo, el motor lo rechaza solo y el diálogo se cierra. Va por encima de Ajustes
// (McpPairing.css): es fácil que la petición llegue con Ajustes abierto.
import { useState } from "react";
import { Bot, Info } from "lucide-react";
import { Modal } from "../ui/Modal";
import { mcp, type McpPairPrompt } from "../../api/mcp";
import { useProfiles } from "../../stores/profiles";
import { toast } from "../../stores/toasts";
import { dropPairRequest, useMcp } from "../../features/mcp/store";
import { cleanAccess, initialAccess } from "../../features/mcp/pairing";
import { useSecondsLeft } from "../../features/mcp/useSecondsLeft";
import { AccessPicker } from "./AccessPicker";
import "./McpPairing.css";

function PairDialog({ req, total }: { req: McpPairPrompt; total: number }) {
  const servers = useProfiles((s) => s.servers);
  const [access, setAccess] = useState(() => initialAccess(servers.map((s) => s.id), req.current));
  const [busy, setBusy] = useState(false);
  const left = useSecondsLeft(req.expiresAt);

  const answer = async (accept: boolean) => {
    setBusy(true);
    try {
      await mcp.pairReply(req.id, accept, accept ? cleanAccess(access) : {});
      if (accept) toast.success(`${req.name} conectado`, "Puedes cambiar sus permisos o revocarlo en Ajustes → Asistentes de IA.");
    } catch (e) {
      toast.error("No se pudo enviar la respuesta", e);
    } finally {
      // El motor avisa con «pair-done»; por si acaso, se quita ya de la cola.
      dropPairRequest(req.id);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      className="mpair-dialog"
      title={total > 1 ? `Conectar un asistente (1 de ${total})` : "Conectar un asistente"}
      onClose={() => void answer(false)}
      width="min(620px, 94vw)"
      footer={
        <>
          <span className="mcp-countdown" aria-live="polite">
            Se rechazará solo en {left} s
          </span>
          <button className="btn" onClick={() => void answer(false)} disabled={busy} autoFocus>
            Rechazar
          </button>
          <button className="btn btn-primary" onClick={() => void answer(true)} disabled={busy}>
            Aceptar
          </button>
        </>
      }
    >
      <div className="mpair-body">
        <p className="mpair-lead">
          <Bot size={16} /> <strong>{req.name}</strong> quiere usar tus servidores a través de SSHorus.
        </p>
        <dl className="mpair-facts">
          <dt>Programa</dt>
          <dd className="mono">{req.program || "—"}</dd>
          <dt>PID</dt>
          <dd className="mono">{req.pid ?? "—"}</dd>
          <dt>Carpeta</dt>
          <dd className="mono">{req.cwd ?? "—"}</dd>
        </dl>
        <p className="mpair-note">
          <Info size={13} /> Estos datos los da el propio equipo (el programa que lo pide). Acepta solo si tú le pediste a tu
          IA que se conectara.
        </p>
        {req.replaces && (
          <p className="mcp-warn">Este asistente ya estaba conectado: si aceptas, su conexión anterior deja de valer.</p>
        )}
        <div className="section-label">Permisos de este asistente</div>
        <AccessPicker servers={servers} access={access} onChange={setAccess} />
        <p className="mpair-muted">
          Nunca verá contraseñas. Todo cambio te pedirá permiso en SSHorus y queda en «Actividad del asistente».
        </p>
      </div>
    </Modal>
  );
}

/** Muestra la petición más antigua; las demás esperan su turno. */
export function PairDialogHost() {
  const requests = useMcp((s) => s.pairRequests);
  const first = requests[0];
  if (!first) return null;
  return <PairDialog key={first.id} req={first} total={requests.length} />;
}
