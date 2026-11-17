// Usuarios protegidos (de un servidor o de todos): la IA no puede crearlos, editarlos ni borrarlos, ni
// escribir en su carpeta personal ni hacer «sudo -u» a ellos. Lo aplica el motor (mcp/protect.rs).
import { useEffect, useState } from "react";
import { toast } from "../../stores/toasts";
import { nameError, parseNames } from "./accessInfo";
import "./Mcp.css";

/** Una línea para la interfaz: con comandos libres solo se puede avisar. */
export const PROTECTED_NOTE =
  "Con comandos libres (o acceso Completo) la protección pregunta siempre y avisa, pero no es infalible.";

interface Props {
  value: string[];
  /** Guarda la lista nueva; true si se guardó. */
  onSave: (names: string[]) => Promise<boolean>;
  label: string;
  placeholder?: string;
}

export function ProtectedInput({ value, onSave, label, placeholder = "root, ana" }: Props) {
  const joined = value.join(", ");
  const [text, setText] = useState(joined);
  useEffect(() => setText(joined), [joined]);
  const dirty = parseNames(text).join(",") !== value.join(",");

  const save = async () => {
    const names = parseNames(text);
    const bad = names.map(nameError).find(Boolean);
    if (bad) {
      toast.error("Nombre no válido", bad);
      return;
    }
    if (await onSave(names)) setText(names.join(", "));
  };

  return (
    <div className="mcp-protected">
      <input
        className="input"
        value={text}
        placeholder={placeholder}
        aria-label={label}
        title="Nombres separados por comas. No hace falta que existan en el servidor."
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && dirty && void save()}
      />
      <button className="btn btn-sm" onClick={() => void save()} disabled={!dirty}>
        Guardar
      </button>
    </div>
  );
}
