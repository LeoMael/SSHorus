// «Añadir a SSHorus»: opciones de un usuario elegido (debajo de su fila): nombre del servidor y llave.
import type { LocalPrivateKey } from "../../api/localkeys";
import type { KeySource } from "../../features/admin";
import { findKey } from "../../features/sshkeys/keys";
import { keyOptionLabel } from "../../features/sshkeys/usage";
import type { WithUsage } from "../../features/sshkeys/useKeyUsage";

export interface UserChoice {
  name: string;
  keyPath: string;
  source: KeySource;
}

type Tag = { text: string; cls: string; title: string };

const SOURCE: Record<KeySource, (install: boolean) => Tag> = {
  authorized: () => ({ text: "Ya autorizada", cls: "adm-tag adm-tag-green", title: "Ya está en su authorized_keys" }),
  install: (on) =>
    on
      ? { text: "Se instalará", cls: "adm-tag adm-tag-accent", title: "Se añade a su authorized_keys antes de guardar" }
      : { text: "No autorizada", cls: "adm-tag adm-tag-yellow", title: "No está en su authorized_keys: activa «Instalar la llave…»" },
  "no-public": () => ({ text: "Sin .pub", cls: "adm-tag adm-tag-yellow", title: "No se encontró su parte pública: no se puede instalar" }),
  agent: () => ({ text: "Agente SSH", cls: "faint", title: "Usará las llaves del agente SSH" }),
};

export function ImportUserOptions({
  user,
  choice,
  keys,
  useKey,
  install,
  sudoWarning,
  onName,
  onKey,
}: {
  user: string;
  choice: UserChoice;
  keys: readonly WithUsage<LocalPrivateKey>[];
  /** Entrará con llave (si no, con contraseña: no hay llave que elegir). */
  useKey: boolean;
  install: boolean;
  sudoWarning: string | null;
  onName: (name: string) => void;
  onKey: (path: string) => void;
}) {
  const tag = SOURCE[choice.source](install);
  const known = !choice.keyPath || !!findKey(keys, choice.keyPath);
  return (
    <div className="iu-opts">
      <input
        className="input iu-opt-name"
        value={choice.name}
        onChange={(e) => onName(e.target.value)}
        aria-label={`Nombre en SSHorus de ${user}`}
        title="Nombre del servidor en SSHorus"
        placeholder={user}
      />
      {useKey && (
        <>
          <select className="input iu-opt-key" value={choice.keyPath} onChange={(e) => onKey(e.target.value)} aria-label={`Llave de ${user}`}>
            {!known && <option value={choice.keyPath}>{choice.keyPath}</option>}
            {keys.map((k) => (
              <option key={k.path} value={k.path}>
                {keyOptionLabel(k, k.usage)}
              </option>
            ))}
            <option value="">Agente SSH</option>
          </select>
          <span className={tag.cls} title={tag.title}>
            {tag.text}
          </span>
        </>
      )}
      {sudoWarning && <div className="iu-opt-warn">{sudoWarning}</div>}
    </div>
  );
}
