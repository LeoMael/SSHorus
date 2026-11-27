// Botón de la barra de la terminal SSH: «Claude Code en este servidor con tu cuenta».
import { useState } from "react";
import { Bot } from "lucide-react";
import { ClaudeVpsDialog } from "./ClaudeVpsDialog";
import type { TermController } from "./termController";

export function ClaudeVpsButton({
  sessionId,
  serverName,
  disabled,
  getController,
}: {
  sessionId: string;
  serverName: string;
  disabled: boolean;
  /** Terminal activa (donde se escriben «Instalar» y «Abrir Claude Code»). */
  getController: () => TermController | undefined;
}) {
  const [open, setOpen] = useState(false);

  /** Escribe el comando (sin secretos) en la terminal activa y lo ejecuta. */
  const type = (cmd: string) => {
    setOpen(false);
    const ctrl = getController();
    if (!ctrl) return;
    ctrl.sendText(`${cmd}\r`);
    ctrl.focus();
  };

  return (
    <>
      <button
        type="button"
        className="icon-btn term-add"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title="Claude Code en este servidor con tu cuenta (sin iniciar sesión aquí)"
        aria-label="Claude Code en este servidor con tu cuenta"
      >
        <Bot size={14} />
      </button>
      {open && <ClaudeVpsDialog sessionId={sessionId} serverName={serverName} onClose={() => setOpen(false)} onType={type} />}
    </>
  );
}
