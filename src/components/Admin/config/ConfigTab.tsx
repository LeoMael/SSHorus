// Sub-pestaña «Configuración» de Administración: cómo está configurado y protegido el servidor (SELinux o
// AppArmor, SSH, cortafuegos, actualizaciones automáticas, fail2ban, sudo, sysctl de red y hidepid), en
// palabras simples y con su cambio donde se puede. Se lee al abrirla (un script de solo lectura) y se
// vuelve a leer tras cada cambio.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, KeyRound, RefreshCw, SlidersHorizontal } from "lucide-react";
import { savedCanvas, saveCanvas } from "../../../features/infra/cache";
import type { Elevation } from "../../../features/privileges";
import { CONFIG_JOB, configEntry, loadServerConfig, useServerConfig, type ConfigChange } from "../../../features/serverConfig";
import { useJobFinished } from "../../Jobs/useJobFinished";
import { useAdmin } from "../context";
import { ConfigChangeDialog } from "./ConfigChangeDialog";
import { ConfigSectionCard } from "./ConfigSectionCard";
import "../audit/Audit.css";
import "../audit/AuditFix.css";
import "./Config.css";

export function ConfigTab({ onOpenMap, onOpenUsers }: { onOpenMap: () => void; onOpenUsers: () => void }) {
  const { sessionId, profileId, elevation, elev, disabled, askSudo } = useAdmin();
  const entry = useServerConfig((s) => configEntry(s, sessionId));
  const [changing, setChanging] = useState<ConfigChange | null>(null);
  const load = useCallback(() => void loadServerConfig(sessionId, elevation), [sessionId, elevation]);

  // Se lee al abrir (si no hay nada guardado) y otra vez si ahora hay sudo y lo guardado se leyó sin él.
  const tried = useRef<Elevation | null | undefined>(undefined);
  useEffect(() => {
    if (disabled || tried.current === elevation) return;
    tried.current = elevation;
    if (!entry.data || (elevation && !entry.data.config.elevated)) load();
  }, [disabled, elevation, entry.data, load]);

  useJobFinished(
    (j) => j.kind === CONFIG_JOB && j.sessionId === sessionId && j.status === "done",
    () => load(),
  );

  const openLink = (to: "firewall" | "users") => {
    if (to === "users") return onOpenUsers();
    // El mapa abre con el nodo del cortafuegos elegido (su panel de reglas).
    const key = `server:${sessionId}`;
    const prev = savedCanvas(key);
    saveCanvas(key, { hideLocal: prev?.hideLocal ?? false, hideSystem: prev?.hideSystem ?? true, owners: prev?.owners ?? null, miniOn: prev?.miniOn ?? true, selected: `${profileId}|fw` });
    onOpenMap();
  };

  const data = entry.data;
  return (
    <div className="adm-pane cf-root">
      <div className="adm-toolbar">
        <button className="btn btn-sm" onClick={load} disabled={disabled || entry.loading} title="Vuelve a leer la configuración (solo lee)">
          {entry.loading ? <span className="spinner adm-spinner-btn" /> : <RefreshCw size={13} />}
          {entry.loading ? "Leyendo…" : "Volver a leer"}
        </button>
        {!elevation && elev.canAskSudo && (
          <button className="btn btn-sm" onClick={askSudo} title="Con sudo se ve todo y se puede cambiar">
            <KeyRound size={13} /> Con sudo…
          </button>
        )}
        {data && (
          <span className="faint cf-when">
            {data.config.os} · {data.config.elevated ? "leído con sudo" : "leído sin sudo (se ve menos)"} · {new Date(data.at).toLocaleTimeString("es-ES", { timeStyle: "short" })}
          </span>
        )}
      </div>
      {entry.error && (
        <div className="adm-banner adm-banner-warn" role="alert">
          <AlertTriangle size={14} />
          <span className="adm-banner-text">No se pudo leer la configuración: {entry.error}</span>
        </div>
      )}
      {data?.elevationError && (
        <div className="adm-banner adm-banner-warn">
          <AlertTriangle size={14} />
          <span className="adm-banner-text">sudo falló ({data.elevationError}): se leyó sin sudo.</span>
        </div>
      )}
      <div className="cf-scroll">
        {!data ? (
          <div className="empty-state">
            {entry.loading ? <span className="spinner" /> : <SlidersHorizontal size={22} />}
            <div>SELinux o AppArmor, SSH, cortafuegos, actualizaciones, fail2ban, sudo, red y procesos, en un solo sitio.</div>
            <div className="faint">Leer no cambia nada; cada cambio enseña antes su comando.</div>
          </div>
        ) : (
          data.config.sections.map((s) => <ConfigSectionCard key={s.id} sec={s} onChange={setChanging} onLink={openLink} />)
        )}
      </div>
      {changing && <ConfigChangeDialog change={changing} onClose={() => setChanging(null)} />}
    </div>
  );
}
