// Cabecera del panel de Contenedores: motor (Podman / Docker), versión, selector «Usuario», marcas
// (rootless, sudo, compose) y «Volver a detectar».
import { RefreshCw, Users } from "lucide-react";
import { OWNER_ALL, composeFor, ownerKey, type EngineStatus } from "../../features/containers";
import { engineLabel, ownerOptionLabel } from "../../features/containers/panelLogic";
import type { OwnerScope } from "./useOwnerScope";
import { JobsButton } from "./JobsButton";

interface Props {
  scope: OwnerScope;
  status: EngineStatus;
  /** Texto de la elevación en uso (p. ej. «sudo»). */
  elevLabel: string;
  detecting: boolean;
  disabled: boolean;
  onRedetect: () => void;
}

export function EngineHeader({ scope, status, elevLabel, detecting, disabled, onRedetect }: Props) {
  const { available, engine, all, current, currentKey, effChoice, options, isRoot, me, usersLoad, needsSudo, elevation } = scope;
  const compose = composeFor(engine, status.compose);
  return (
    <div className="ct-header">
      {available.length > 1 ? (
        <div className="ct-seg" role="radiogroup" aria-label="Motor de contenedores">
          {available.map((s) => (
            <button
              key={s.engine}
              role="radio"
              aria-checked={s.engine === engine}
              className={s.engine === engine ? "on" : ""}
              onClick={() => scope.chooseEngine(s.engine)}
            >
              {engineLabel(s.engine)}
            </button>
          ))}
        </div>
      ) : (
        <strong className="ct-engine-name">{engineLabel(engine)}</strong>
      )}
      <span className="faint ct-ver">{status.version ? `v${status.version}` : ""}</span>
      {scope.canElevate && (options.length > 1 || scope.waitingUsers) && (
        <label className="ct-owner" title="Con root o sudo puedes ver los contenedores de root y los de cada usuario">
          <Users size={13} />
          <span>Usuario</span>
          <select
            className="select ct-select-sm"
            value={all ? OWNER_ALL : current ? currentKey : effChoice}
            onChange={(e) => scope.chooseOwner(e.target.value)}
            aria-label="De qué usuario se ven los contenedores"
          >
            {options.map((o) => (
              <option key={ownerKey(o)} value={ownerKey(o)}>
                {ownerOptionLabel(o, { isRoot, engine, rootless: status.rootless, me })}
              </option>
            ))}
            {!all && !current && effChoice.startsWith("u:") && <option value={effChoice}>{effChoice.slice(2)}</option>}
            <option value={OWNER_ALL}>Todos</option>
          </select>
          {usersLoad.loading && <span className="spinner ct-spinner-xs" aria-label="Buscando usuarios" />}
          {usersLoad.error && (
            <span className="ct-badge ct-badge-warn" title={usersLoad.error}>
              sin lista de usuarios
            </span>
          )}
        </label>
      )}
      {!all && current && (current.kind === "user" || (current.kind === "self" && status.rootless)) && <span className="ct-badge">rootless</span>}
      {needsSudo && <span className="ct-badge ct-badge-warn">{elevation ? elevLabel : "necesita sudo"}</span>}
      {compose && <span className="ct-badge">{compose}</span>}
      <span className="ct-grow" />
      <JobsButton sessionId={scope.runner.sessionId} />
      <button
        className="icon-btn"
        title="Volver a detectar (y a buscar usuarios)"
        aria-label="Volver a detectar"
        onClick={onRedetect}
        disabled={detecting || disabled}
      >
        <RefreshCw size={14} className={detecting ? "ct-spin" : undefined} />
      </button>
    </div>
  );
}
