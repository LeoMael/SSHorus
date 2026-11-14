// PIN o contraseña nuevos: elegir el tipo y escribirlo dos veces. Lo usan crear y cambiar.
import { useRef } from "react";
import { PASSWORD_MIN_LENGTH, PIN_LENGTH, type NewPinKind } from "../../api/vault";
import { PasswordInput } from "./PasswordInput";
import { PinCode, type PinCodeHandle } from "./PinCode";

export interface NewSecretValue {
  kind: NewPinKind;
  value: string;
  again: string;
}

export const emptyNewSecret = (kind: NewPinKind = "pin6"): NewSecretValue => ({ kind, value: "", again: "" });

const KINDS: { kind: NewPinKind; label: string }[] = [
  { kind: "pin6", label: "PIN" },
  { kind: "password", label: "Contraseña" },
];

/** Selector «PIN / Contraseña». */
function KindChooser({
  kind,
  onChange,
  disabled,
}: {
  kind: NewPinKind;
  onChange: (k: NewPinKind) => void;
  disabled?: boolean;
}) {
  return (
    <div className="lock-kind" role="radiogroup" aria-label="Proteger con">
      {KINDS.map((o) => (
        <button
          key={o.kind}
          type="button"
          role="radio"
          aria-checked={kind === o.kind}
          className={kind === o.kind ? "active" : ""}
          onClick={() => onChange(o.kind)}
          disabled={disabled}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function NewSecretFields({
  state,
  onChange,
  onReady,
  autoFocus,
  disabled,
}: {
  state: NewSecretValue;
  onChange: (s: NewSecretValue) => void;
  /** Al completar la repetición del PIN, o Enter en la repetición de la contraseña. */
  onReady: (s: NewSecretValue) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const first = useRef<PinCodeHandle>(null);
  const second = useRef<PinCodeHandle>(null);
  const pin = state.kind === "pin6";
  const set = (patch: Partial<NewSecretValue>) => onChange({ ...state, ...patch });
  // Al cambiar de tipo se vacía lo escrito (un PIN no vale como contraseña y al revés).
  const setKind = (kind: NewPinKind) => {
    if (kind === state.kind) return;
    onChange(emptyNewSecret(kind));
    requestAnimationFrame(() => first.current?.focus());
  };

  return (
    <>
      <div className="field">
        <span>Proteger con</span>
        <KindChooser kind={state.kind} onChange={setKind} disabled={disabled} />
      </div>
      <div className="field">
        <span>{pin ? `PIN nuevo (${PIN_LENGTH} números)` : `Contraseña nueva (${PASSWORD_MIN_LENGTH} caracteres o más)`}</span>
        {pin ? (
          <PinCode
            key="pin"
            ref={first}
            value={state.value}
            onChange={(value) => set({ value })}
            onComplete={() => second.current?.focus()}
            label="PIN nuevo"
            autoFocus={autoFocus}
            disabled={disabled}
          />
        ) : (
          <PasswordInput
            key="password"
            ref={first}
            value={state.value}
            onChange={(value) => set({ value })}
            onEnter={() => second.current?.focus()}
            label="Contraseña nueva"
            autoFocus={autoFocus}
            disabled={disabled}
          />
        )}
      </div>
      <div className="field">
        <span>{pin ? "Repítelo" : "Repítela"}</span>
        {pin ? (
          <PinCode
            key="pin-again"
            ref={second}
            value={state.again}
            onChange={(again) => set({ again })}
            onComplete={(again) => onReady({ ...state, again })}
            onEnter={() => onReady(state)}
            label="Repite el PIN"
            disabled={disabled}
          />
        ) : (
          <PasswordInput
            key="password-again"
            ref={second}
            value={state.again}
            onChange={(again) => set({ again })}
            onEnter={() => onReady(state)}
            label="Repite la contraseña"
            disabled={disabled}
          />
        )}
      </div>
    </>
  );
}
