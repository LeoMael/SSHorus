// Botón de la llave en la barra de la terminal SSH: escribe la contraseña de sudo del servidor cuando la
// terminal la está pidiendo. Siempre pide antes el PIN o la contraseña de SSHorus, y solo la escribe si
// la línea del cursor es un aviso de contraseña (nunca a la vista ni en el historial de la shell).
import { useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { errorMessage, isApiError } from "../../api/core";
import { profiles } from "../../api/profiles";
import { vault } from "../../api/vault";
import { toast } from "../../stores/toasts";
import { Modal } from "../ui/Modal";
import { applyVaultStatus, useLock } from "../../features/lock/lockStore";
import { PinField } from "../../features/lock/PinField";
import { secretWords } from "../../features/lock/secretKind";
import { isPasswordPrompt } from "./passwordPrompt";
import type { TermController } from "./termController";

const NO_VAULT = "Configura un PIN o contraseña en Ajustes → Seguridad para usar esto";
const NOT_ASKING = "La terminal no está pidiendo una contraseña";

/** La terminal sigue abierta y su línea del cursor es un aviso de contraseña. */
function isAsking(ctrl: TermController): boolean {
  return ctrl.isRunning() && isPasswordPrompt(ctrl.cursorLineText());
}

export function SudoPasswordButton({
  sessionId,
  profileId,
  serverName,
  disabled,
  getController,
}: {
  sessionId: string;
  /** null = conexión sin servidor guardado. */
  profileId: string | null;
  serverName: string;
  disabled: boolean;
  /** Terminal activa (se toma al pulsar: es la que recibe la contraseña aunque luego se cambie). */
  getController: () => TermController | undefined;
}) {
  const vaultOn = useLock((s) => !!s.status?.enabled);
  const target = useRef<TermController | null>(null);
  const [asking, setAsking] = useState(false);

  const start = () => {
    const ctrl = getController();
    if (!ctrl) return;
    if (!vaultOn) {
      toast.info(NO_VAULT);
    } else if (!isAsking(ctrl)) {
      toast.info(NOT_ASKING, "Usa este botón cuando aparezca «[sudo] password for…» o «Contraseña:».");
    } else {
      target.current = ctrl;
      setAsking(true);
      return;
    }
    ctrl.focus();
  };

  const finish = (password: string | null) => {
    setAsking(false);
    const ctrl = target.current;
    target.current = null;
    if (!ctrl) return;
    // Pudo cambiar mientras se escribía el PIN (sudo se cansó de esperar, la shell terminó…).
    if (password !== null) {
      if (isAsking(ctrl)) ctrl.sendText(`${password}\r`);
      else toast.info(NOT_ASKING, "No se escribió nada.");
    }
    ctrl.focus();
  };

  const title = !profileId
    ? "Escribir la contraseña de sudo (solo en servidores guardados)"
    : "Escribir la contraseña de sudo (cuando la terminal la pide)";

  return (
    <>
      <button
        type="button"
        className="icon-btn term-add"
        onClick={start}
        disabled={disabled || !profileId}
        title={title}
        aria-label="Escribir la contraseña de sudo"
      >
        <KeyRound size={14} />
      </button>
      {asking && profileId && (
        <SudoPinDialog sessionId={sessionId} profileId={profileId} serverName={serverName} onDone={finish} />
      )}
    </>
  );
}

/** Pide el PIN o la contraseña de SSHorus y trae la contraseña de sudo (null = cancelado o no hay). */
function SudoPinDialog({
  sessionId,
  profileId,
  serverName,
  onDone,
}: {
  sessionId: string;
  profileId: string;
  serverName: string;
  onDone: (password: string | null) => void;
}) {
  const status = useLock((s) => s.status);
  const words = secretWords(status?.pinKind);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (p: string) => {
    if (busy || !p) return;
    setBusy(true);
    setError(null);
    try {
      const password = await profiles.revealSudoPassword(profileId, p, sessionId);
      if (password === null) {
        toast.info(
          "Este servidor no tiene una contraseña de sudo guardada",
          "Guárdala al editar el servidor (sudo: «Guardar» o «La de la conexión»).",
        );
      }
      onDone(password);
    } catch (err) {
      setError(isApiError(err, "AuthFailed") ? words.wrong : errorMessage(err));
      setPin("");
      setBusy(false);
      vault.status().then(applyVaultStatus).catch(() => {});
    }
  };

  const cancel = () => onDone(null);

  return (
    <Modal
      open
      title="Contraseña de sudo"
      onClose={cancel}
      width={400}
      footer={
        <>
          <button type="button" className="btn" onClick={cancel}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit(pin)} disabled={busy || !pin}>
            Escribir
          </button>
        </>
      }
    >
      <div className="term-sudo">
        <p className="term-sudo-text">
          Escribe {words.your} de SSHorus para escribir en la terminal la contraseña de sudo de «{serverName}».
        </p>
        <PinField
          kind={status?.pinKind ?? "pin6"}
          value={pin}
          onChange={(v) => {
            setPin(v);
            setError(null);
          }}
          onSubmit={(v) => void submit(v)}
          label={words.Noun}
          autoFocus
          disabled={busy}
          invalid={!!error}
        />
        {error && (
          <div className="term-sudo-err" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
