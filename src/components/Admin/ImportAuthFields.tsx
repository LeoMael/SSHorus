// «Añadir a SSHorus»: cómo entrarán los servidores creados (llave SSH o contraseña).
import type { LocalPublicKey } from "../../api/localkeys";
import { Segmented } from "./Segmented";

export type AuthKind = "key" | "password";

export interface AuthChoice {
  kind: AuthKind;
  keyPath: string;
  install: boolean;
  test: boolean;
}

export function ImportAuthFields({
  value,
  onChange,
  locals,
  publicKey,
}: {
  value: AuthChoice;
  onChange: (v: AuthChoice) => void;
  locals: LocalPublicKey[] | null;
  /** Llave pública que corresponde a la ruta elegida (null = no se encontró). */
  publicKey: LocalPublicKey | null;
}) {
  const set = (p: Partial<AuthChoice>) => onChange({ ...value, ...p });
  const privates = (locals ?? []).flatMap((l) => (l.privatePath ? [l.privatePath] : []));
  return (
    <div className="iu-auth">
      <div className="field">
        <span className="adm-field-label">Cómo entrarán</span>
        <Segmented
          label="Autenticación"
          value={value.kind}
          onChange={(kind) => set({ kind })}
          options={[
            { value: "key", label: "Llave SSH" },
            { value: "password", label: "Contraseña" },
          ]}
        />
      </div>
      {value.kind === "password" ? (
        <div className="adm-note">La contraseña se pedirá al conectar. No se guarda nada.</div>
      ) : (
        <>
          <label className="field">
            <span>Llave privada de este equipo (vacío = agente SSH)</span>
            <input
              className="input mono"
              list="iu-local-keys"
              value={value.keyPath}
              spellCheck={false}
              placeholder="~/.ssh/id_ed25519"
              onChange={(e) => set({ keyPath: e.target.value })}
            />
            <datalist id="iu-local-keys">
              {privates.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <label className="checkbox adm-check" title={publicKey ? publicKey.line : undefined}>
            <input type="checkbox" checked={value.install && !!publicKey} disabled={!publicKey} onChange={(e) => set({ install: e.target.checked })} />
            Instalar mi llave pública en su <span className="mono">authorized_keys</span> (con sudo, sin duplicar)
          </label>
          {!publicKey && locals !== null && (
            <div className="faint iu-hint">
              {value.keyPath.trim()
                ? "No se encontró su llave pública (.pub) en ~/.ssh: no se puede instalar."
                : "Para instalarla, elige la llave privada (su .pub debe estar en ~/.ssh)."}
            </div>
          )}
        </>
      )}
      <label className="checkbox adm-check">
        <input type="checkbox" checked={value.test} onChange={(e) => set({ test: e.target.checked })} />
        Probar la conexión al terminar
      </label>
    </div>
  );
}
