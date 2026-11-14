// Formulario del servidor → «Llave privada»: elige una llave de ~/.ssh (detectadas solas), otra con
// «Examinar…» o crea una nueva con el asistente.
import { useEffect, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { homeDir, join } from "@tauri-apps/api/path";
import { FolderOpen } from "lucide-react";
import { toast } from "../../stores/toasts";
import { SSH_KEY_EXAMPLE } from "../../lib/platform";
import { useLocalKeysOnMount } from "./store";
import { findKey, keyDetails, keyLabel } from "./keys";
import { CreateKeyWizard } from "./CreateKeyWizard";
import "./SshKeys.css";

const OTHER = "__other__";

/** Abre el selector de archivos en ~/.ssh. null = cancelado. */
async function browsePrivateKey(): Promise<string | null> {
  let defaultPath: string | undefined;
  try {
    defaultPath = await join(await homeDir(), ".ssh");
  } catch {
    defaultPath = undefined;
  }
  const picked = await openFileDialog({ title: "Elegir llave privada", defaultPath, multiple: false, directory: false });
  return typeof picked === "string" ? picked : null;
}

export function KeyPicker({
  value,
  onChange,
  error,
  serverId,
}: {
  value: string;
  onChange: (path: string) => void;
  error?: string;
  /** Servidor ya guardado (el asistente lo propone para poner la llave). */
  serverId?: string;
}) {
  const { data } = useLocalKeysOnMount();
  const keys = data?.keys ?? [];
  const match = findKey(keys, value);
  const [typing, setTyping] = useState(false);
  const [wizard, setWizard] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Escribir la ruta a mano: lo pidió, la ruta no es de ~/.ssh o no hay llaves detectadas. */
  const manual = typing || (!!value.trim() && !match) || (data !== null && keys.length === 0);

  // Campo vacío: se preselecciona la llave más común (la primera de la lista), una sola vez.
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || !data) return;
    preselected.current = true;
    if (!value.trim() && data.keys[0]) onChange(data.keys[0].path);
  }, [data, value, onChange]);

  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing]);

  const browse = async () => {
    try {
      const p = await browsePrivateKey();
      if (p) {
        onChange(p);
        setTyping(false);
      }
    } catch (e) {
      toast.error("No se pudo abrir el selector de archivos", e);
    }
  };

  return (
    <div className="field">
      <span id="sk-picker-label">Llave privada</span>
      <div className="sk-picker">
        <div className="sk-picker-row">
          {keys.length > 0 && (
            <select
              className="select mono"
              aria-labelledby="sk-picker-label"
              value={manual ? OTHER : match?.path ?? OTHER}
              onChange={(e) => {
                if (e.target.value === OTHER) {
                  setTyping(true);
                  onChange("");
                } else {
                  setTyping(false);
                  onChange(e.target.value);
                }
              }}
            >
              {keys.map((k) => (
                <option key={k.path} value={k.path}>
                  {keyLabel(k)}
                </option>
              ))}
              <option value={OTHER}>Otra llave (escribir la ruta)…</option>
            </select>
          )}
          {manual && (
            <input
              ref={inputRef}
              className="input mono"
              aria-labelledby="sk-picker-label"
              value={value}
              spellCheck={false}
              placeholder={SSH_KEY_EXAMPLE}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
          <button type="button" className="btn" onClick={() => void browse()}>
            <FolderOpen size={14} /> Examinar…
          </button>
        </div>
        <div className="sk-picker-foot">
          {data && keys.length === 0 && <span>No hay llaves en {data.dir}.</span>}
          {match && !manual && <span className="mono">{keyDetails(match)}</span>}
          <button type="button" className="sk-link" onClick={() => setWizard(true)}>
            ¿No tienes? Crear una
          </button>
        </div>
      </div>
      {error && <div className="cd-err">{error}</div>}
      {wizard && (
        // Las teclas del asistente (Intro) no deben llegar al formulario del servidor (Intro = Guardar).
        <div onKeyDown={(e) => e.stopPropagation()}>
          <CreateKeyWizard
            serverId={serverId}
            onClose={() => setWizard(false)}
            onCreated={(k) => {
              setTyping(false);
              onChange(k.privatePath);
            }}
          />
        </div>
      )}
    </div>
  );
}
