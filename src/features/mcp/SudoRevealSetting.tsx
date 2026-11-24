// Ajustes → Asistentes de IA: si la IA puede pedir VER la contraseña de sudo (`request_sudo_password`).
// Apagado por defecto: la IA usa las contraseñas (sudo, run_with_password) pero nunca las ve. Encendido,
// cada vez se pregunta con un diálogo propio.
import { useState } from "react";
import { mcp, type McpConfig } from "../../api/mcp";
import { SettingRow } from "../../components/ui/SettingsKit";
import { toast } from "../../stores/toasts";

export function SudoRevealSetting({ cfg, onChange }: { cfg: McpConfig | null; onChange: (cfg: McpConfig) => void }) {
  const [busy, setBusy] = useState(false);
  const on = cfg?.allowSudoReveal ?? false;
  const label = "Permitir que la IA pida ver la contraseña de sudo (siempre te pregunta)";

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
      hint={
        on
          ? "Si se la das, la contraseña queda en la conversación con la IA."
          : "Apagado: la IA puede usar las contraseñas pero nunca verlas (recomendado)."
      }
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
