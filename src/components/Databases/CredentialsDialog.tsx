// Usuario y contraseña de una base de datos (cuando no se pudo entrar sin contraseña). La contraseña va
// por stdin al servidor y llega al cliente por su variable (PGPASSWORD, MYSQL_PWD): nunca a la línea de
// comandos. «Guardar» la deja en la bóveda o el llavero, para este servidor y esta base.
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { AdmModal } from "../ui/AdmModal";
import type { DbTarget } from "../../features/databases";

interface Props {
  target: DbTarget;
  /** Por qué no se pudo entrar (lo último que dijo la base). */
  reason: string | null;
  onSubmit: (user: string, password: string, save: boolean) => Promise<boolean>;
  onClose: () => void;
}

const DEFAULT_USER: Record<DbTarget["engine"], string> = { postgres: "postgres", mysql: "root", sqlite: "" };

export function CredentialsDialog({ target, reason, onSubmit, onClose }: Props) {
  const [user, setUser] = useState(DEFAULT_USER[target.engine]);
  const [password, setPassword] = useState("");
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !user.trim()) return;
    setBusy(true);
    setError(null);
    const ok = await onSubmit(user.trim(), password, save);
    setBusy(false);
    if (ok) onClose();
    else setError("No se pudo entrar con ese usuario y contraseña.");
  };

  return (
    <AdmModal title={`Entrar en ${target.label}`} onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="modal-body">
          {reason && <pre className="db-reason">{reason}</pre>}
          <label className="field">
            <span>Usuario de la base de datos</span>
            <input className="input" value={user} autoFocus={!user} autoComplete="off" onChange={(e) => setUser(e.target.value)} />
          </label>
          <label className="field" title="Se envía por la entrada estándar y llega al programa por su variable de entorno, nunca en la línea de comandos.">
            <span>Contraseña</span>
            <input
              className="input"
              type="password"
              value={password}
              autoFocus={!!user}
              autoComplete="off"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="checkbox" title="Se guarda cifrada con tu PIN o contraseña de SSHorus (o en el llavero si no tienes bloqueo).">
            <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
            Guardar para esta base de datos
          </label>
          <p className="faint db-dialog-note">Solo se lee el esquema (tablas, columnas, índices y relaciones): no se cambia nada.</p>
          {error && (
            <div className="field-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !user.trim()}>
            {busy ? <span className="spinner db-spinner-btn" /> : <KeyRound size={13} />}
            Entrar
          </button>
        </div>
      </form>
    </AdmModal>
  );
}
