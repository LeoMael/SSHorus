// Tarjeta de un VPS: estado, avisos, cifras y usuarios guardados. Clic → abre su pestaña.
import type { KeyboardEvent, MouseEvent } from "react";
import { Plug, RotateCw, ShieldCheck } from "lucide-react";
import type { Vps } from "../../features/fleet";
import { warnings, worstLevel, type VpsLive } from "../../features/fleet/health";
import { fleetConnect, fleetRetry, openVps, rebootVps } from "../../features/fleet/runtime";
import { RebootButtonView, serverKey, useRebootRun } from "../../features/reboot";
import { VpsMetrics } from "./VpsMetrics";

const STATUS_TEXT: Record<VpsLive["status"], string> = {
  waiting: "En espera",
  connecting: "Conectando…",
  online: "En línea",
  offline: "Sin conexión",
  attention: "Necesita que conectes tú",
};

const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

function Users({ v, live }: { v: Vps; live: VpsLive }) {
  const info = new Map((live.probe?.users ?? []).map((u) => [u.name, u]));
  return (
    <div className="fl-users">
      {v.profiles.map((p) => {
        const u = info.get(p.username);
        const tag = u?.root ? "root" : u?.sudo ? "sudo" : null;
        return (
          <button
            key={p.id}
            className={`fl-user${p.id === live.profileId ? " current" : ""}${u && !u.exists ? " missing" : ""}`}
            title={`${p.name} · ${p.username}@${v.host}${u && !u.exists ? " (este usuario no existe en el servidor)" : ""}\nClic: abrir con este usuario`}
            onClick={stop(() => openVps(v, p))}
          >
            {p.username}
            {tag && (
              <span className="fl-user-tag">
                <ShieldCheck size={11} /> {tag}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function StateBody({ v, live }: { v: Vps; live: VpsLive }) {
  if (live.status === "attention") {
    return (
      <div className="fl-state">
        <p>{live.message ?? "Pide contraseña o un código."}</p>
        <button className="btn btn-sm btn-primary" onClick={stop(() => fleetConnect(v.key))}>
          <Plug size={13} /> Conectar
        </button>
      </div>
    );
  }
  if (live.status === "offline" && !live.probe) {
    const secs = Math.max(0, Math.round((live.nextAt - Date.now()) / 1000));
    return (
      <div className="fl-state">
        <p>{live.message ?? "No responde."}</p>
        <button className="btn btn-sm" onClick={stop(() => fleetRetry(v.key))} title={`Próximo intento solo en ${secs} s`}>
          <RotateCw size={13} /> Reintentar
        </button>
      </div>
    );
  }
  if (!live.probe) {
    return (
      <div className="fl-state">
        <div className="spinner" />
      </div>
    );
  }
  return <VpsMetrics live={live} />;
}

function RebootRow({ v }: { v: Vps }) {
  const run = useRebootRun(serverKey(v));
  return (
    <div className="fl-reboot">
      <RebootButtonView run={run} onClick={() => void rebootVps(v)} title="Reinicia el servidor (abre su pestaña si hace falta), espera a que vuelva y reconecta" />
    </div>
  );
}

export function VpsCard({ v, live }: { v: Vps; live: VpsLive }) {
  const ws = warnings(live);
  const level = live.status === "attention" ? "warn" : worstLevel(ws);
  const p = live.probe;
  const sub = [`${v.host}${v.port !== 22 ? `:${v.port}` : ""}`, p?.os, p?.hostname && p.hostname !== v.name ? p.hostname : null].filter(Boolean).join(" · ");
  const onKey = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      openVps(v);
    }
  };
  return (
    <div
      className={`fl-card${level ? ` ${level}` : ""}${live.status === "offline" ? " offline" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => openVps(v)}
      onKeyDown={onKey}
      title="Abrir la pestaña de este servidor"
    >
      <div className="fl-card-head">
        <span className={`fl-dot ${live.status}`} title={STATUS_TEXT[live.status]} />
        <span className="fl-card-name">{v.name}</span>
        <span className="fl-card-lat faint" title="Lo que tardó en responder la última lectura">
          {live.status === "online" && live.latencyMs !== null ? `${live.latencyMs} ms` : STATUS_TEXT[live.status]}
        </span>
      </div>
      <div className="fl-card-sub faint">{sub}</div>
      {ws.length > 0 && (
        <div className="fl-warns">
          {ws.map((w) => (
            <span key={w.text} className={`fl-warn ${w.level}`}>
              {w.text}
            </span>
          ))}
        </div>
      )}
      <StateBody v={v} live={live} />
      {p?.rebootRequired && live.status === "online" && <RebootRow v={v} />}
      <Users v={v} live={live} />
    </div>
  );
}
