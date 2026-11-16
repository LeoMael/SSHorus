// Ajustes → Asistentes de IA: «La IA puede pedir la contraseña de sudo» (`request_sudo_password`).
// Encendido por defecto; aun así, cada vez se pregunta con un diálogo propio.
import { useState } from "react";
import { mcp, type McpConfig } from "../../api/mcp";
import { SettingRow } from "../../components/ui/SettingsKit";
import { toast } from "../../stores/toasts";

export function SudoRevealSetting({ cfg, onChange }: { cfg: McpConfig | null; onChange: (cfg: McpConfig) => void }) {
  const [busy, setBusy] = useState(false);
  const on = cfg?.allowSudoPasswordRequest ?? true;
  const label = "La IA puede pedir la contraseña de sudo (siempre te pregunta)";

  const toggle = async () => {
    setBusy(true);
    try {
      onChange(await mcp.setSudoPasswordRequest(!on));
    } catch (e) {
      toast.error("No se pudo guardar", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingRow
      label={label}
      hint="Si lo permites, la contraseña queda en la conversación con la IA. Para comandos con sudo no hace falta: SSHorus la pone sin que la IA la vea."
    >
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={on ? "st-switch on" : "st-switch"}
        onClick={() => void toggle()}
        disabled={busy || !cfg}
      >
        <span />
      </button>
    </SettingRow>
  );
}
