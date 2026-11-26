// Campo de contraseña de usuario con «Generar segura», mostrar y copiar (Crear usuario y «Nuevo usuario con clave»).
import { useState } from "react";
import { Copy, Eye, EyeOff, Sparkles } from "lucide-react";
import { generatePassword } from "../../lib/password";
import { clipboard } from "../../lib/clipboard";
import { toast } from "../../stores/toasts";

/** Copia al portapapeles (motor; si falla, el del navegador). */
export async function copyText(text: string) {
  try {
    await clipboard.write(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

/** Campo de contraseña con «Generar segura», mostrar y copiar. */
export function PasswordField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="adm-pass">
        <input
          className="input mono"
          type={show ? "text" : "password"}
          value={value}
          autoComplete="new-password"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="icon-btn"
          onClick={() => setShow((s) => !s)}
          title={show ? "Ocultar" : "Mostrar"}
          aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={!value}
          onClick={() =>
            copyText(value).then(
              () => toast.success("Contraseña copiada"),
              (e) => toast.error("No se pudo copiar", e),
            )
          }
          title="Copiar"
          aria-label="Copiar contraseña"
        >
          <Copy size={14} />
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            onChange(generatePassword());
            setShow(true);
          }}
        >
          <Sparkles size={13} /> Generar segura
        </button>
      </div>
    </label>
  );
}
