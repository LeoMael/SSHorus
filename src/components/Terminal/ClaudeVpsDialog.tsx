// Diálogo «Claude Code en este servidor con tu cuenta»: lleva la cuenta de Claude Code del PC al usuario del
// servidor (llave de acceso o sesión copiada), la quita y abre Claude Code en la terminal SSH.
// La sesión copiada nunca pasa por aquí: la lee y la envía el motor. La llave pegada solo va al motor.
import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, Trash2 } from "lucide-react";
import { errorMessage } from "../../api/core";
import type { ClaudeVpsSent } from "../../api/localterm";
import { toast } from "../../stores/toasts";
import { confirmDialog } from "../ui/dialogs";
import { Modal } from "../ui/Modal";
import {
  ROOT_WARNING,
  activeMode,
  cleanToken,
  currentAccount,
  launchCommand,
  looksLikeToken,
  openSetupToken,
  readStatus,
  rememberMode,
  rememberedMode,
  removeAccount,
  sendAccount,
  type ClaudeVpsMode,
  type ClaudeVpsStatus,
} from "../../features/claudeVps";
import { ClaudeInstallBox, ModePicker, SessionStep, TokenStep } from "./ClaudeVpsParts";
import "./ClaudeVps.css";

interface Props {
  sessionId: string;
  serverName: string;
  onClose: () => void;
  /** Escribe un comando en la terminal SSH activa y lo ejecuta (y cierra el diálogo). */
  onType: (cmd: string) => void;
}

export function ClaudeVpsDialog({ sessionId, serverName, onClose, onType }: Props) {
  const [st, setSt] = useState<ClaudeVpsStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<ClaudeVpsMode>(() => rememberedMode(sessionId) ?? "token");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ result: ClaudeVpsSent; mode: ClaudeVpsMode } | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setSt(await readStatus(sessionId));
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = (m: ClaudeVpsMode) => {
    setMode(m);
    rememberMode(sessionId, m);
  };

  const clean = cleanToken(token);
  const tokenOk = looksLikeToken(clean);
  const canSend = !!st && !busy && (mode === "session" || tokenOk);

  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      const result = await sendAccount(sessionId, mode, token);
      setToken("");
      setSent({ result, mode });
      setSt(await readStatus(sessionId).catch(() => st));
    } catch (e) {
      toast.error("No se pudo poner tu cuenta en el servidor", e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: "Quitar mi cuenta de este servidor",
      message: `Se borra de «${serverName}» lo que puso SSHorus: la llave de acceso, la sesión copiada (si el servidor tenía otra, se repone) y la línea añadida al inicio de la shell. Las terminales ya abiertas siguen con la llave hasta que las cierres.`,
      confirmText: "Quitar",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await removeAccount(sessionId);
      toast.success(
        "Tu cuenta ya no está en el servidor",
        r.restored ? "Se repuso la sesión de Claude Code que el servidor tenía antes." : undefined,
      );
      setSent(null);
      await load();
    } catch (e) {
      toast.error("No se pudo quitar tu cuenta", e);
    } finally {
      setBusy(false);
    }
  };

  const createToken = async () => {
    rememberMode(sessionId, "token");
    if (await openSetupToken(serverName)) onClose();
  };

  const launchMode = sent?.mode ?? (st ? activeMode(st) : null);
  const launch = st && st.claude && launchMode ? launchCommand(st, launchMode) : null;
  const account = st ? currentAccount(st) : null;

  const footer = (
    <>
      <button type="button" className="btn" onClick={onClose}>
        {sent ? "Cerrar" : "Cancelar"}
      </button>
      {launch && (sent || account) && (
        <button type="button" className={sent ? "btn btn-primary" : "btn"} onClick={() => onType(launch)} disabled={busy}>
          Abrir Claude Code en la terminal
        </button>
      )}
      {!sent && (
        <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={!canSend}>
          {mode === "token" ? "Poner la llave en el servidor" : "Copiar mi sesión al servidor"}
        </button>
      )}
    </>
  );

  return (
    <Modal open title="Claude Code en este servidor con tu cuenta" onClose={onClose} width={540} footer={footer}>
      <div className="cvps">
        {!st && !loadError && <p className="cvps-muted">Mirando el servidor…</p>}
        {loadError && (
          <div className="cvps-err" role="alert">
            {loadError}{" "}
            <button type="button" className="btn btn-sm" onClick={() => void load()}>
              Reintentar
            </button>
          </div>
        )}
        {st && (
          <>
            <p className="cvps-line">
              Tu cuenta se pone en el usuario <b>{st.user || "?"}</b> de «{serverName}», con el que entraste.
            </p>
            <ClaudeInstallBox st={st} onType={onType} />
            {sent ? (
              <div className="cvps-done" role="status">
                <p className="cvps-line">Listo: tu cuenta de Claude Code ya está en el servidor.</p>
                {sent.result.backup && (
                  <p className="cvps-muted">La sesión que ya tenía el servidor se guardó y se repondrá al quitar tu cuenta.</p>
                )}
                {launch ? (
                  <p className="cvps-muted">
                    Para abrirlo en una terminal de este servidor: <code>{launch}</code>
                  </p>
                ) : (
                  <p className="cvps-muted">Instala Claude Code y después ábrelo con «claude» en la terminal.</p>
                )}
              </div>
            ) : (
              <>
                {account && (
                  <div className="cvps-current">
                    <span>{account}</span>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove()} disabled={busy}>
                      <Trash2 size={14} /> Quitar mi cuenta de este servidor
                    </button>
                  </div>
                )}
                <ModePicker mode={mode} onChange={pick} />
                {mode === "token" ? (
                  <TokenStep
                    token={token}
                    invalid={clean.length > 0 && !tokenOk}
                    disabled={busy}
                    onToken={setToken}
                    onCreate={() => void createToken()}
                    onSubmit={() => void send()}
                  />
                ) : (
                  <SessionStep st={st} />
                )}
              </>
            )}
            <p className="cvps-warn">
              <ShieldAlert size={14} /> {ROOT_WARNING}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
