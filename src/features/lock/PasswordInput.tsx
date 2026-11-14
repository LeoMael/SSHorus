// Campo de contraseña de la bóveda con botón para mostrarla u ocultarla. Enter no sale del campo
// (no llega a formularios de fuera, p. ej. guardaría el servidor).
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useRefocus, type PinCodeHandle } from "./PinCode";

interface PasswordInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Enter con algo escrito. */
  onEnter?: () => void;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}

export const PasswordInput = forwardRef<PinCodeHandle, PasswordInputProps>(function PasswordInput(
  { value, onChange, onEnter, label, placeholder, autoFocus, disabled, invalid },
  ref,
) {
  const input = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState(false);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);
  useRefocus(input, autoFocus, disabled);

  return (
    <div className="lock-pass">
      <input
        ref={input}
        className="input"
        type={shown ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          e.stopPropagation();
          if (value) onEnter?.();
        }}
      />
      <button
        type="button"
        className="icon-btn"
        onClick={() => setShown(!shown)}
        // Que el foco siga en el campo al pulsar el ojo.
        onMouseDown={(e) => e.preventDefault()}
        disabled={disabled}
        title={shown ? "Ocultar" : "Mostrar"}
        aria-label={shown ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={shown}
      >
        {shown ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
});
