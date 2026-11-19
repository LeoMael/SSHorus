// Ventana del indicador «Automático»: qué servidores aceptan solos, qué permiten y cuánto les queda.
// Nada se apaga sin verlo: «Apagar» por fila y «Apagar todo» (con confirmación).
import { useState } from "react";
import { Zap } from "lucide-react";
import type { McpAutoState } from "../../api/mcp";
import { Modal } from "../../components/ui/Modal";
import { confirmDialog } from "../../components/ui/dialogs";
import { autoOffAll, autoText, setAutoAccept } from "./AutoAccept";
import "./Mcp.css";

const LEVEL_INFO: Record<"changes" | "all", string> = {
  changes: "Acepta solo los cambios normales; lo peligroso y sudo siguen pidiendo permiso.",
  all: "Acepta todo sin preguntar, incluidos sudo y los comandos peligrosos.",
};

function AutoRow({ a, now }: { a: McpAutoState; now: number }) {
  const [busy, setBusy] = useState(false);
  const off = async () => {
    setBusy(true);
    await setAutoAccept(a.serverId, a.serverName, "off", "session");
    setBusy(false);
  };
  const all = a.level === "all";
  return (
    <li className={all ? "mcp-autop-row all" : "mcp-autop-row"}>
      <div className="mcp-autop-info">
        <strong>{a.serverName}</strong>
        <small>{autoText(a, now)}</small>
        <small className="mcp-autop-what">{LEVEL_INFO[all ? "all" : "changes"]}</small>
      </div>
      <button className="btn btn-sm" disabled={busy} onClick={() => void off()} aria-label={`Apagar en ${a.serverName}`}>
        Apagar
      </button>
    </li>
  );
}

export function AutoActivePanel({ list, now, onClose }: { list: McpAutoState[]; now: number; onClose: () => void }) {
  const offAll = async () => {
    const ok = await confirmDialog({
      title: "Apagar «Aceptar automáticamente»",
      message: `Se apagará en ${list.length === 1 ? "1 servidor" : `${list.length} servidores`}. El asistente volverá a pedirte permiso.`,
      confirmText: "Apagar todo",
    });
    if (!ok) return;
    await autoOffAll();
    onClose();
  };

  return (
    <Modal
      open
      title="Aceptar automáticamente"
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cerrar
          </button>
          {list.length > 0 && (
            <button className="btn btn-danger" onClick={() => void offAll()}>
              Apagar todo
            </button>
          )}
        </>
      }
    >
      <p className="mcp-autop-intro">
        <Zap size={13} /> En estos servidores el asistente no te pide permiso para lo que se indica.
      </p>
      {list.length === 0 ? (
        <p className="mcp-autop-intro">Ya no queda ninguno activo.</p>
      ) : (
        <ul className="mcp-autop-list">
          {list.map((a) => (
            <AutoRow key={a.serverId} a={a} now={now} />
          ))}
        </ul>
      )}
    </Modal>
  );
}
