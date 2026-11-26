// Pestaña «Bases de datos» del servidor: lista de lo que se encontró (PostgreSQL y MySQL/MariaDB del
// sistema o en contenedores, y los SQLite que añadas) y el esquema de la elegida. Solo lectura.
import { lazy, Suspense, useState } from "react";
import { Box, Database, FileText, KeyRound, Plus, RefreshCw, Server, X } from "lucide-react";
import { ENGINE_LABEL } from "../../features/databases/discover";
import { groupTargets } from "../../features/databases/view";
import type { DbTarget } from "../../features/databases";
import { TargetView } from "./TargetView";
import { useDbPanel } from "./useDbPanel";
import { useTargetSessions } from "./useTargetSessions";
import "./Databases.css";

const SudoDialog = lazy(() => import("../Sudo/SudoDialog").then((m) => ({ default: m.SudoDialog })));

export interface DatabasesPanelProps {
  sessionId: string;
  profileId: string;
  active: boolean;
  disabled: boolean;
}

const PLACE_ICON = { host: Server, container: Box, file: FileText } as const;

export function DatabasesPanel({ sessionId, profileId, active, disabled }: DatabasesPanelProps) {
  const p = useDbPanel({ sessionId, profileId, active, disabled });
  const sessions = useTargetSessions(p.ctx, profileId, p.refreshSaved);
  const [sudoOpen, setSudoOpen] = useState(false);
  const groups = groupTargets(p.targets);

  const row = (t: DbTarget) => {
    const Icon = PLACE_ICON[t.place.kind];
    const on = p.current?.key === t.key;
    return (
      <li key={t.key} className={on ? "db-target-row on" : "db-target-row"}>
        <button className="db-target-pick" onClick={() => p.select(t.key)} aria-current={on || undefined} title={`${ENGINE_LABEL[t.engine]} · ${t.detail}`}>
          <Icon size={14} className={`db-engine db-engine-${t.engine}`} />
          <span className="db-target-text">
            <span className="db-target-label">{t.label}</span>
            <span className="faint db-target-sub">{t.place.kind === "file" ? ENGINE_LABEL.sqlite : t.detail}</span>
          </span>
          {p.saved.has(t.key) && <KeyRound size={12} className="faint" aria-label="Contraseña guardada" />}
        </button>
        {t.place.kind === "file" && (
          <button className="icon-btn db-target-x" title="Quitar de la lista" onClick={() => t.place.kind === "file" && p.removeSqlite(t.place.path)}>
            <X size={12} />
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="db-root">
      <div className="db-header">
        <span className="db-header-title">
          <Database size={15} /> Bases de datos <span className="faint">· solo lectura</span>
        </span>
        <div className="db-header-actions">
          {p.discovery && !p.discovery.elevated && p.elev.canAskSudo && (
            <button className="btn btn-sm" onClick={() => setSudoOpen(true)} title="Con sudo se ven las bases del sistema y los contenedores de otros usuarios">
              <KeyRound size={13} /> Usar sudo
            </button>
          )}
          <button className="btn btn-sm" onClick={() => void p.addSqlite()} disabled={disabled} title="Abrir un archivo SQLite del servidor (no se busca por el disco)">
            <Plus size={13} /> SQLite…
          </button>
          <button className="icon-btn" title="Volver a buscar" disabled={disabled || p.loading} onClick={() => void p.discover()}>
            <RefreshCw size={14} className={p.loading ? "db-spin" : undefined} />
          </button>
        </div>
      </div>

      <div className="db-body">
        <aside className="db-side" aria-label="Bases encontradas">
          {disabled ? (
            <p className="faint db-note">Conéctate para buscar bases de datos.</p>
          ) : p.error ? (
            <div className="db-banner db-banner-error">No se pudo buscar: {p.error}</div>
          ) : !p.discovery && p.loading ? (
            <div className="empty-state">
              <div className="spinner" />
              <span>Buscando bases de datos…</span>
            </div>
          ) : groups.length === 0 ? (
            <p className="faint db-note">
              No se encontró PostgreSQL ni MySQL/MariaDB{p.discovery?.elevated ? "" : " (sin sudo solo se ven tus contenedores y los puertos conocidos)"}. Si
              usas SQLite, añade el archivo con «SQLite…».
            </p>
          ) : (
            groups.map((g) => (
              <section key={g.title}>
                <div className="section-label db-group">{g.title}</div>
                <ul className="db-targets">{g.targets.map(row)}</ul>
              </section>
            ))
          )}
          {p.discovery?.notes.map((n) => (
            <p key={n} className="faint db-note">
              {n}
            </p>
          ))}
        </aside>
        <main className="db-main">
          {p.current ? (
            <TargetView target={p.current} sessions={sessions} saved={p.saved.has(p.current.key)} disabled={disabled} />
          ) : (
            <div className="empty-state">
              <Database size={28} className="faint" />
              <span>Elige una base de la lista para ver sus tablas, columnas y relaciones.</span>
              <span className="faint">SSHorus entra sin contraseña si puede (socket local, sudo o dentro del contenedor); si no, te la pide.</span>
            </div>
          )}
        </main>
      </div>

      {sudoOpen && (
        <Suspense fallback={null}>
          <SudoDialog sessionId={sessionId} profileId={profileId} user={p.info?.user ?? null} onClose={() => setSudoOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
