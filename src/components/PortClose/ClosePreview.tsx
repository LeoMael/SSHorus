// Vista previa de la forma elegida para cerrar el puerto: los comandos exactos (y cómo se deshace) o, si
// SSHorus no puede hacerlo solo, qué hay que cambiar.
import { Info, ShieldCheck, Timer } from "lucide-react";
import { TRIAL_SECS } from "../../features/infra/firewall/commands";
import { needsElevation, type CloseAction } from "../../features/portClose";
import { elevationText, type Elevation } from "../../features/privileges";

export function ClosePreview({ action, elevation }: { action: CloseAction; elevation: Elevation | null }) {
  if (action.kind === "compose" || action.kind === "hint") {
    return (
      <p className="pc-hint">
        <Info size={13} /> {action.hint}
      </p>
    );
  }
  if (action.kind === "run") {
    return (
      <>
        <div className="pc-label">{needsElevation(action) ? elevationText(elevation) : "Se ejecutará como tu usuario (sin sudo):"}</div>
        <pre className="pc-cmd" aria-label="Comandos que se ejecutarán">
          {action.steps.map((s) => s.show).join("\n")}
        </pre>
      </>
    );
  }
  const plan = action.plan;
  return (
    <>
      <div className="pc-label">{elevationText(elevation)}</div>
      <pre className="pc-cmd" aria-label="Comandos que se ejecutarán">
        {plan.apply.join("\n")}
      </pre>
      <p className="pc-safe">
        <Timer size={13} /> Se aplica a prueba: si en {TRIAL_SECS / 60} minutos no lo confirmas (en el aviso de la tarea), el servidor lo deshace solo.
        {plan.permanent.length > 0 && " Al confirmar se guarda con:"}
      </p>
      {plan.permanent.length > 0 && <pre className="pc-cmd pc-cmd-sm">{plan.permanent.join("\n")}</pre>}
      {plan.checkLogin && (
        <p className="pc-safe">
          <ShieldCheck size={13} /> Después SSHorus prueba a entrar con una conexión SSH nueva; si no puede, lo deshace enseguida.
        </p>
      )}
      <details className="pc-undo">
        <summary>Cómo se deshace</summary>
        <pre className="pc-cmd pc-cmd-sm">{plan.revert.join("\n")}</pre>
      </details>
    </>
  );
}
