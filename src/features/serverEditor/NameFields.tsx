// Nombre del servidor y alias para «ssh <alias>».
import type { Ref } from "react";
import { AlertTriangle } from "lucide-react";
import { SSH_CONFIG_LABEL } from "../../lib/platform";
import { SshAliasMatches, describeMatch } from "../sshAliases";
import type { AliasState } from "./useSshAlias";

export function NameFields({
  name,
  host,
  onName,
  alias,
  onAliasEdit,
  inputRef,
}: {
  name: string;
  host: string;
  onName: (v: string) => void;
  alias: AliasState;
  /** Se escribió en el alias (para limpiar su error). */
  onAliasEdit: () => void;
  inputRef: Ref<HTMLInputElement>;
}) {
  return (
    <div className="cd-cols">
      <label className="field">
        <span>Nombre</span>
        <input
          ref={inputRef}
          className="input"
          value={name}
          placeholder={host.trim() || "p. ej. web-prod"}
          onChange={(e) => onName(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Alias para ssh (opcional)</span>
        <input
          className="input mono"
          value={alias.value}
          spellCheck={false}
          autoCapitalize="off"
          placeholder={alias.info && !alias.value.trim() ? `${alias.info.alias} (automático)` : "Se genera a partir del nombre"}
          onChange={(e) => {
            alias.setValue(e.target.value);
            onAliasEdit();
          }}
        />
        <AliasNote state={alias} />
      </label>
    </div>
  );
}

function AliasNote({ state }: { state: AliasState }) {
  const { info, error } = state;
  if (error) return <div className="cd-err">{error}</div>;
  if (!info) return null;
  if (info.matches.length === 0) {
    return (
      <div className="ssha-inline">
        Con «ssh <span className="mono">{info.alias}</span>» desde cualquier terminal (si exportas a {SSH_CONFIG_LABEL}).
      </div>
    );
  }
  return (
    <div className="ssha-inline warn" role="status" title={info.matches.map(describeMatch).join("\n")}>
      <div className="ssha-inline-row">
        <AlertTriangle size={13} />
        <span>
          «<span className="mono">{info.alias}</span>» ya aparece en tu {SSH_CONFIG_LABEL} escrito a mano.
        </span>
        {info.suggestion && (
          <button type="button" className="ssha-linkbtn" onClick={() => info.suggestion && state.setValue(info.suggestion)}>
            Usar «{info.suggestion}»
          </button>
        )}
      </div>
      <SshAliasMatches matches={info.matches} />
    </div>
  );
}
