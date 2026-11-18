// «Contraseña de sudo» del servidor: de dónde sale y, con «Guardar», la contraseña.
import { AlertTriangle } from "lucide-react";
import type { SudoMode } from "../../api/types";
import { SecretInput } from "../SecretInput";
import { sudoFormHint, sudoModesFor, type SudoFormState } from "../privileges/sudoFormHint";
import { SegmentedRadio } from "./SegmentedRadio";
import { SAVED_SECRET_PLACEHOLDER, type ServerFormFields } from "./serverForm";
import type { SetFields } from "./useServerForm";

const SUDO_LABELS: Record<SudoMode, string> = { ask: "Pedir cada vez", login: "La de la conexión", saved: "Guardar" };

export function SudoField({
  fields,
  set,
  sudoForm,
  profileId,
  hasSudoSecret,
}: {
  fields: ServerFormFields;
  set: SetFields;
  sudoForm: SudoFormState;
  /** "" = servidor nuevo. */
  profileId: string;
  hasSudoSecret: boolean | null;
}) {
  const hint = sudoFormHint(sudoForm);
  return (
    <div className="field">
      <span>Contraseña de sudo</span>
      <SegmentedRadio
        label="Contraseña de sudo"
        value={fields.sudoMode}
        options={sudoModesFor(fields.auth).map((m) => ({ value: m, label: SUDO_LABELS[m] }))}
        onChange={(m) => set({ sudoMode: m })}
      />
      {fields.sudoMode === "saved" && (
        <SecretInput
          profileId={profileId}
          kind="sudo"
          stored={!!hasSudoSecret}
          value={fields.sudoSecret}
          onChange={(v) => set({ sudoSecret: v })}
          label="Contraseña de sudo"
          placeholder={hasSudoSecret ? SAVED_SECRET_PLACEHOLDER : "Tu contraseña en el servidor"}
        />
      )}
      {hint.warn ? (
        <div className="ssha-inline warn" role="status">
          <div className="ssha-inline-row">
            <AlertTriangle size={13} />
            <span>{hint.text}</span>
          </div>
        </div>
      ) : (
        <small className="cd-field-hint">{hint.text}</small>
      )}
    </div>
  );
}
