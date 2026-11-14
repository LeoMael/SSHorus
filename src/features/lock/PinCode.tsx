// Entrada de PIN: 6 casillas con puntos. Por debajo es un solo campo numérico (inputMode="numeric"),
// así avanzar, borrar y pegar el PIN entero funcionan solos. `PinField` elige entre esto y un campo
// de contraseña (`PasswordInput`).
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { PIN_LENGTH } from "../../api/vault";

export interface PinCodeHandle {
  focus: () => void;
}

/** Con autoFocus, vuelve a poner el foco al reactivarse (tras comprobar un PIN o contraseña incorrectos, o esperar). */
export function useRefocus(ref: RefObject<HTMLInputElement | null>, autoFocus: boolean | undefined, disabled: boolean | undefined) {
  const was = useRef(disabled);
  useEffect(() => {
    if (was.current && !disabled && autoFocus) ref.current?.focus();
    was.current = disabled;
  }, [ref, autoFocus, disabled]);
}

interface PinCodeProps {
  value: string;
  onChange: (v: string) => void;
  /** Al escribir el sexto número. */
  onComplete?: (v: string) => void;
  /** Enter con el PIN completo (por si no se usa `onComplete`). */
  onEnter?: () => void;
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}

export const PinCode = forwardRef<PinCodeHandle, PinCodeProps>(function PinCode(
  { value, onChange, onComplete, onEnter, label, autoFocus, disabled, invalid },
  ref,
) {
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);
  useRefocus(input, autoFocus, disabled);

  const set = (raw: string) => {
    const v = raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
    onChange(v);
    if (v.length === PIN_LENGTH && v !== value) onComplete?.(v);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    // Que Enter no llegue a formularios de fuera (p. ej. guardaría el servidor).
    e.preventDefault();
    e.stopPropagation();
    if (value.length === PIN_LENGTH) onEnter?.();
  };

  const active = Math.min(value.length, PIN_LENGTH - 1);
  return (
    <div
      className={`pin-code${disabled ? " disabled" : ""}${invalid ? " invalid" : ""}`}
      onMouseDown={(e) => {
        if (e.target !== input.current) e.preventDefault();
        input.current?.focus();
      }}
    >
      {Array.from({ length: PIN_LENGTH }, (_, i) => (
        <span key={i} className={`pin-box${focused && i === active ? " active" : ""}${i < value.length ? " filled" : ""}`}>
          {i < value.length ? "•" : ""}
        </span>
      ))}
      <input
        ref={input}
        className="pin-input"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        spellCheck={false}
        maxLength={PIN_LENGTH}
        aria-label={label}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          setFocused(true);
          // El cursor siempre al final: así cada número va a la siguiente casilla.
          const el = e.currentTarget;
          requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
        }}
        onBlur={() => setFocused(false)}
        onSelect={(e) => {
          const el = e.currentTarget;
          if (el.selectionStart !== el.value.length) el.setSelectionRange(el.value.length, el.value.length);
        }}
      />
    </div>
  );
});
