// Campo para escribir el PIN o la contraseña actuales, según el tipo de la bóveda: 6 casillas
// para el PIN; campo de texto con ojo para la contraseña y para las bóvedas antiguas ("text").
// Se usa en la pantalla de bloqueo, al ver una contraseña guardada, al cambiar y al quitar.
import type { PinKind } from "../../api/vault";
import { PasswordInput } from "./PasswordInput";
import { PinCode } from "./PinCode";

export function PinField({
  kind,
  value,
  onChange,
  onSubmit,
  label,
  autoFocus,
  disabled,
  invalid,
}: {
  kind: PinKind;
  value: string;
  onChange: (v: string) => void;
  /** Al completar los 6 números, o Enter en el campo de texto. */
  onSubmit?: (v: string) => void;
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}) {
  if (kind === "pin6") {
    return (
      <PinCode
        value={value}
        onChange={onChange}
        onComplete={onSubmit}
        onEnter={() => onSubmit?.(value)}
        label={label}
        autoFocus={autoFocus}
        disabled={disabled}
        invalid={invalid}
      />
    );
  }
  return (
    <PasswordInput
      value={value}
      onChange={onChange}
      onEnter={() => onSubmit?.(value)}
      label={label}
      placeholder={kind === "password" ? "Contraseña" : "PIN"}
      autoFocus={autoFocus}
      disabled={disabled}
      invalid={invalid}
    />
  );
}
