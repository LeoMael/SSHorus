// «Añadir a SSHorus»: opciones de un usuario elegido (debajo de su fila): nombre del servidor, cómo
// entrará (llave ya autorizada, llave nueva, llave mía o contraseña) y su llave o contraseña.
import type { ReactNode } from "react";
import type { LocalPrivateKey } from "../../../api/localkeys";
import { ACCESS_METHODS, accessStatus, type AccessEdit, type AccessMethod, type RowAccess, type StatusTone } from "../../../features/admin";
import { keyOptionLabel } from "../../../features/sshkeys/usage";
import type { WithUsage } from "../../../features/sshkeys";

type Key = WithUsage<LocalPrivateKey>;

const TONE: Record<StatusTone, string> = {
  green: "adm-tag adm-tag-green",
  accent: "adm-tag adm-tag-accent",
  yellow: "adm-tag adm-tag-yellow",
  muted: "adm-tag iu-tag-muted",
};

export interface OptionsProps {
  user: string;
  name: string;
  access: RowAccess;
  methods: readonly AccessMethod[];
  /** Llaves ya autorizadas de este usuario. */
  authorized: readonly Key[];
  /** Llaves de este equipo que se pueden instalar. */
  installable: readonly Key[];
  /** Archivo de la llave nueva (si es el método elegido). */
  newKeyPath: string;
  canInstall: boolean;
  sudoWarning: string | null;
  onName: (name: string) => void;
  onEdit: (e: AccessEdit) => void;
}

function KeySelect({ user, value, keys, onChange }: { user: string; value: string; keys: readonly Key[]; onChange: (p: string) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`Llave de ${user}`}>
      {!value && <option value="">Elige una llave…</option>}
      {keys.map((k) => (
        <option key={k.path} value={k.path}>
          {keyOptionLabel(k, k.usage)}
        </option>
      ))}
    </select>
  );
}

/** Tercera columna según el método: qué llave, qué archivo nuevo o qué contraseña. */
const DETAIL: Record<AccessMethod, { label: string; render: (p: OptionsProps) => ReactNode }> = {
  authorized: {
    label: "Llave",
    render: (p) => <KeySelect user={p.user} value={p.access.keyPath} keys={p.authorized} onChange={(keyPath) => p.onEdit({ keyPath })} />,
  },
  "new-key": {
    label: "Llave nueva (en este equipo)",
    render: (p) => (
      <div className="input iu-readonly mono" title={p.newKeyPath}>
        {p.newKeyPath}
      </div>
    ),
  },
  "my-key": {
    label: "Llave",
    render: (p) => <KeySelect user={p.user} value={p.access.keyPath} keys={p.installable} onChange={(keyPath) => p.onEdit({ keyPath })} />,
  },
  password: {
    label: "Contraseña (opcional)",
    render: (p) => (
      <input
        className="input"
        type="password"
        autoComplete="new-password"
        value={p.access.password}
        placeholder="Se pide al conectar"
        onChange={(e) => p.onEdit({ password: e.target.value })}
        aria-label={`Contraseña de ${p.user}`}
      />
    ),
  },
};

export function ImportUserOptions(p: OptionsProps) {
  const detail = DETAIL[p.access.method];
  const tag = accessStatus(p.access, p.canInstall);
  return (
    <div className="iu-opts">
      <label className="iu-opt">
        <span className="iu-opt-label">Nombre en SSHorus</span>
        <input className="input" value={p.name} onChange={(e) => p.onName(e.target.value)} placeholder={p.user} aria-label={`Nombre en SSHorus de ${p.user}`} />
      </label>
      <label className="iu-opt">
        <span className="iu-opt-label">Cómo entra</span>
        <select className="input" value={p.access.method} onChange={(e) => p.onEdit({ method: e.target.value as AccessMethod })} aria-label={`Cómo entra ${p.user}`}>
          {ACCESS_METHODS.filter((m) => p.methods.includes(m.value)).map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="iu-opt">
        <span className="iu-opt-label">{detail.label}</span>
        {detail.render(p)}
      </label>
      <span className={`${TONE[tag.tone]} iu-opt-tag`} title={tag.title}>
        {tag.text}
      </span>
      {p.sudoWarning && <div className="iu-opt-warn">{p.sudoWarning}</div>}
    </div>
  );
}
