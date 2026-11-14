// Diálogo de la protección abierto desde el candado de la barra de pestañas (crear o cambiar).
import { Modal } from "../../components/ui/Modal";
import { WhatItProtects } from "./LockInfo";
import { useLock } from "./lockStore";
import { ChangePinForm, SetupPinForm } from "./PinForms";
import { secretWords } from "./secretKind";
import "./Lock.css";

export function PinDialogHost() {
  const dialog = useLock((s) => s.pinDialog);
  const enabled = useLock((s) => !!s.status?.enabled);
  const kind = useLock((s) => s.status?.pinKind);
  const close = () => useLock.setState({ pinDialog: null });
  if (!dialog) return null;
  // Si el estado cambió mientras tanto (p. ej. otra ventana creó el PIN), no tiene sentido.
  if ((dialog === "change") !== enabled) return null;
  const title = dialog === "change" ? `Cambiar ${secretWords(kind).noun}` : "Proteger con PIN o contraseña";
  return (
    <Modal open title={title} onClose={close} width={420}>
      {dialog === "change" ? (
        <ChangePinForm onDone={close} onCancel={close} />
      ) : (
        <div className="lock-form">
          <WhatItProtects />
          <SetupPinForm autoFocus onDone={close} onCancel={close} />
        </div>
      )}
    </Modal>
  );
}
