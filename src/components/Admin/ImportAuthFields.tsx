// «Añadir a SSHorus»: cómo entrarán los servidores creados (llave SSH o contraseña). La llave de cada
// usuario se elige en su fila.
import { Segmented } from "./Segmented";

export type AuthKind = "key" | "password";

export interface AuthChoice {
  kind: AuthKind;
  /** Instalar la llave elegida a los usuarios que aún no la tienen autorizada. */
  install: boolean;
  test: boolean;
}

export function ImportAuthFields({
  value,
  onChange,
  defaultKeyName,
}: {
  value: AuthChoice;
  onChange: (v: AuthChoice) => void;
  /** Llave que se usa cuando ninguna de este equipo está ya autorizada ("" = agente SSH). */
  defaultKeyName: string;
}) {
  const set = (p: Partial<AuthChoice>) => onChange({ ...value, ...p });
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
          <div className="faint iu-hint iu-hint-flush">
            Cada usuario usa la llave de este equipo que ya tenga autorizada; si no tiene ninguna,{" "}
            {defaultKeyName ? <span className="mono">{defaultKeyName}</span> : "el agente SSH"}. Puedes cambiarla en su fila.
          </div>
          <label className="checkbox adm-check">
            <input type="checkbox" checked={value.install} onChange={(e) => set({ install: e.target.checked })} />
            Instalar la llave en su <span className="mono">authorized_keys</span> si aún no la tiene (con sudo, sin duplicar)
          </label>
        </>
      )}
      <label className="checkbox adm-check">
        <input type="checkbox" checked={value.test} onChange={(e) => set({ test: e.target.checked })} />
        Probar la conexión al terminar
      </label>
    </div>
  );
}
