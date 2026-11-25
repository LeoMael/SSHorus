// Una base elegida: entrar (solo, la primera vez que se ve), pedir usuario y contraseña si hace falta,
// elegir la base de datos y ver su esquema.
import { useEffect, useState } from "react";
import { KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { authLabel } from "../../features/databases/auth";
import type { DbTarget } from "../../features/databases/types";
import { CredentialsDialog } from "./CredentialsDialog";
import { SchemaView } from "./SchemaView";
import type { TargetSessions } from "./useTargetSessions";

interface Props {
  target: DbTarget;
  sessions: TargetSessions;
  saved: boolean;
  disabled: boolean;
}

function Loading({ text, onCancel }: { text: string; onCancel?: () => void }) {
  return (
    <div className="empty-state" role="status">
      <div className="spinner" />
      <span>{text}</span>
      {onCancel && (
        <button className="btn btn-sm" onClick={onCancel}>
          Cancelar
        </button>
      )}
    </div>
  );
}

export function TargetView({ target: t, sessions, saved, disabled }: Props) {
  const state = sessions.states[t.key];
  const [askOpen, setAskOpen] = useState(false);
  const { open } = sessions;

  // Primera vez que se elige: entrar.
  useEffect(() => {
    if (!state && !disabled) void open(t);
  }, [state, disabled, open, t]);

  const db = state?.phase === "open" ? state.database : null;
  const load = state?.phase === "open" && db ? state.schemas[db] : undefined;

  let body;
  if (!state || state.phase === "opening") body = <Loading text="Entrando en la base de datos…" />;
  else if (state.phase === "need-auth" || state.phase === "error") {
    body = (
      <div className="db-problem">
        <pre className="db-reason">{state.message}</pre>
        <div className="db-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setAskOpen(true)} disabled={disabled}>
            <KeyRound size={13} /> Entrar con usuario y contraseña
          </button>
          <button className="btn btn-sm" onClick={() => void open(t)} disabled={disabled}>
            <RefreshCw size={13} /> Reintentar
          </button>
        </div>
      </div>
    );
  } else if (!load) body = <div className="empty-state">Elige una base de datos.</div>;
  else if (load.state === "loading") body = <Loading text="Leyendo el esquema…" onCancel={() => sessions.cancel(t)} />;
  else if (load.state === "error") {
    body = (
      <div className="db-problem">
        <pre className="db-reason">{load.message}</pre>
        <div className="db-actions">
          <button className="btn btn-sm" onClick={() => db && sessions.pickDatabase(t, db, true)} disabled={disabled}>
            <RefreshCw size={13} /> Reintentar
          </button>
        </div>
      </div>
    );
  } else body = <SchemaView key={`${t.key}|${db}`} schema={load.schema} onCopyDdl={(x) => sessions.copyDdl(t, x.schema, x.name)} />;

  return (
    <div className="db-target">
      <div className="db-target-head">
        <div className="db-target-title">
          <strong>{t.label}</strong>
          <span className="faint">
            {t.detail}
            {state?.phase === "open" && ` · ${authLabel(t, state.auth)}`}
          </span>
        </div>
        {state?.phase === "open" && state.list && (
          <select
            className="select db-db-select"
            value={db ?? ""}
            onChange={(e) => sessions.pickDatabase(t, e.target.value)}
            aria-label="Base de datos"
            disabled={disabled}
          >
            {!db && <option value="">Elige una base…</option>}
            {state.list.databases.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
                {d.bytes !== null ? ` (${formatBytes(d.bytes)})` : ""}
              </option>
            ))}
          </select>
        )}
        <button
          className="icon-btn"
          title="Volver a leer"
          disabled={disabled || state?.phase === "opening"}
          onClick={() => (state?.phase === "open" && db ? sessions.pickDatabase(t, db, true) : void open(t))}
        >
          <RefreshCw size={14} />
        </button>
        {state?.phase === "open" && (
          <button className="icon-btn" title="Entrar con otro usuario" disabled={disabled} onClick={() => setAskOpen(true)}>
            <KeyRound size={14} />
          </button>
        )}
        {saved && (
          <button className="icon-btn" title="Olvidar la contraseña guardada de esta base" onClick={() => void sessions.forget(t)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {t.problem && <div className="db-banner">{t.problem}</div>}
      {state?.phase === "open" && state.list?.databases.length === 0 && <div className="db-banner">Tu usuario no ve ninguna base de datos aquí.</div>}
      <div className="db-target-body">{body}</div>
      {askOpen && (
        <CredentialsDialog
          target={t}
          reason={state?.phase === "need-auth" ? state.message : null}
          onSubmit={(user, password, save) => sessions.login(t, user, password, save)}
          onClose={() => setAskOpen(false)}
        />
      )}
    </div>
  );
}
