// Autenticación del servidor: método, contraseña o llave (con su frase) y si se guardan.
import type { AuthMethod } from "../../api/types";
import { SecretInput } from "../SecretInput";
import { KeyPicker } from "../sshkeys/KeyPicker";
import { SegmentedRadio } from "./SegmentedRadio";
import { pickAuth, SAVED_SECRET_PLACEHOLDER, type FormErrors, type ServerFormFields } from "./serverForm";
import type { ClearError, SetFields } from "./useServerForm";

/** Dónde van las contraseñas guardadas. */
const SAVE_TIP = "Se guarda cifrada con tu PIN o contraseña de SSHorus o, si no tienes bloqueo, en el llavero del sistema.";

const AUTH_OPTIONS: { value: AuthMethod; label: string }[] = [
  { value: "password", label: "Contraseña" },
  { value: "key", label: "Llave SSH" },
  { value: "agent", label: "Agente SSH" },
];

/** Textos del secreto de cada método que lo tiene. */
const SECRET_TEXTS = {
  password: { title: "Contraseña", label: "Contraseña", placeholder: "Opcional: se pedirá al conectar", remember: "Guardar contraseña" },
  key: { title: "Frase de la llave (opcional)", label: "Frase de la llave", placeholder: "Si la llave está protegida", remember: "Guardar la frase" },
};

interface Props {
  fields: ServerFormFields;
  set: SetFields;
  errors: FormErrors;
  clearErr: ClearError;
  /** "" = servidor nuevo. */
  profileId: string;
  isNew: boolean;
  hasSecret: boolean | null;
}

export function AuthFields({ fields, set, errors, clearErr, profileId, isNew, hasSecret }: Props) {
  const { auth } = fields;
  return (
    <>
      <div className="field">
        <span>Autenticación</span>
        <SegmentedRadio label="Autenticación" value={auth} options={AUTH_OPTIONS} onChange={(a) => set(pickAuth(fields, a))} />
      </div>

      {auth === "password" && <SecretRow method="password" fields={fields} set={set} profileId={profileId} hasSecret={hasSecret} />}

      {auth === "key" && (
        <>
          <KeyPicker
            value={fields.keyPath}
            onChange={(p) => {
              set({ keyPath: p });
              clearErr("keyPath");
            }}
            error={errors.keyPath}
            serverId={isNew ? undefined : profileId}
          />
          <SecretRow method="key" fields={fields} set={set} profileId={profileId} hasSecret={hasSecret} />
        </>
      )}

      {auth === "agent" && <div className="cd-hint">Se usarán las llaves cargadas en tu agente SSH (ssh-agent).</div>}
    </>
  );
}

/** Contraseña o frase de la llave, con la casilla para guardarla. */
function SecretRow({
  method,
  fields,
  set,
  profileId,
  hasSecret,
}: {
  method: keyof typeof SECRET_TEXTS;
  fields: ServerFormFields;
  set: SetFields;
  profileId: string;
  hasSecret: boolean | null;
}) {
  const t = SECRET_TEXTS[method];
  return (
    <div className="cd-cols">
      <div className="field">
        <span>{t.title}</span>
        <SecretInput
          profileId={profileId}
          kind="login"
          stored={!!hasSecret}
          value={fields.secret}
          onChange={(v) => set({ secret: v })}
          label={t.label}
          placeholder={hasSecret ? SAVED_SECRET_PLACEHOLDER : t.placeholder}
        />
      </div>
      <label className="checkbox cd-check" title={SAVE_TIP}>
        <input type="checkbox" checked={fields.remember} onChange={(e) => set({ remember: e.target.checked })} />
        {t.remember}
      </label>
    </div>
  );
}
