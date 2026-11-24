// Cabecera (pestañas, modo de privilegios, botones sudo/recargar) y avisos de Administración.
import type { KeyboardEvent, ReactNode } from "react";
import {
  Bug,
  ClipboardCheck,
  Eye,
  Globe,
  History,
  KeyRound,
  LogOut,
  MonitorDot,
  Network,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unplug,
  Users,
  UsersRound,
  Waypoints,
} from "lucide-react";
import type { ReadResult } from "../../features/admin";
import type { Elevation, PrivilegeInfo } from "../../features/privileges";
import { forgetSudoByUser, type ElevationState } from "../../features/privileges";
import { toast } from "../../stores/toasts";

export type SubTab = "users" | "groups" | "sessions" | "ports" | "web" | "map" | "vulns" | "audit" | "visibility" | "history";

export const ADMIN_TABS: { id: SubTab; label: string; icon: ReactNode }[] = [
  { id: "users", label: "Usuarios", icon: <Users size={14} /> },
  { id: "groups", label: "Grupos", icon: <UsersRound size={14} /> },
  { id: "sessions", label: "Conectados ahora", icon: <MonitorDot size={14} /> },
  { id: "ports", label: "Puertos", icon: <Network size={14} /> },
  { id: "web", label: "Sitios web", icon: <Globe size={14} /> },
  { id: "map", label: "Mapa", icon: <Waypoints size={14} /> },
  { id: "vulns", label: "Vulnerabilidades", icon: <Bug size={14} /> },
  { id: "audit", label: "Auditoría", icon: <ClipboardCheck size={14} /> },
  { id: "visibility", label: "Qué pueden ver", icon: <Eye size={14} /> },
  { id: "history", label: "Historial", icon: <History size={14} /> },
];

/** Sub-pestañas que necesitan la lectura de usuarios y grupos. */
export const NEEDS_READ: SubTab[] = ["users", "groups", "sessions"];

interface HeaderProps {
  sessionId: string;
  tab: SubTab;
  setTab: (t: SubTab) => void;
  read: ReadResult | null;
  info: PrivilegeInfo | null;
  elev: ElevationState;
  elevation: Elevation | null;
  disabled: boolean;
  busy: boolean;
  onChangeSudo: () => void;
  onRefresh: () => void;
}

export function AdminHeader({
  sessionId,
  tab,
  setTab,
  read,
  info,
  elev,
  elevation,
  disabled,
  busy,
  onChangeSudo,
  onRefresh,
}: HeaderProps) {
  const onTabKey = (e: KeyboardEvent) => {
    const i = ADMIN_TABS.findIndex((t) => t.id === tab);
    let n: number;
    if (e.key === "ArrowRight") n = (i + 1) % ADMIN_TABS.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + ADMIN_TABS.length) % ADMIN_TABS.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = ADMIN_TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(ADMIN_TABS[n].id);
    document.getElementById(`adm-tab-${sessionId}-${ADMIN_TABS[n].id}`)?.focus();
  };

  const modeClass =
    elevation?.kind === "root" ? "root" : elevation ? "sudo" : info?.level === "unknown" ? "unknown" : "ro";

  return (
    <div className="adm-header">
      <div className="adm-tabs" role="tablist" aria-label="Secciones de administración" onKeyDown={onTabKey}>
        {ADMIN_TABS.map((t) => (
          <button
            key={t.id}
            id={`adm-tab-${sessionId}-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`adm-panel-${sessionId}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`adm-tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            {t.label}
            {t.id === "sessions" && read && read.who.length > 0 && <span className="adm-count">{read.who.length}</span>}
          </button>
        ))}
      </div>
      <div className="adm-header-right">
        <span className={`adm-mode adm-mode-${modeClass}`} title={elev.readOnlyReason ?? `Los cambios se hacen como root (${elev.label})`}>
          {elevation ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
          {elevation ? elev.label : "Solo lectura"}
        </span>
        {info?.hasSudo && info.level !== "root" && info.level !== "sudo-nopasswd" && (
          <button
            className="btn btn-sm"
            onClick={onChangeSudo}
            disabled={disabled}
            title="Escribe la contraseña de sudo y guárdala para este servidor"
          >
            <KeyRound size={13} /> Cambiar contraseña de sudo…
          </button>
        )}
        {elev.hasPassword && (
          <button
            className="icon-btn"
            onClick={() => {
              forgetSudoByUser(sessionId);
              toast.info("Contraseña de sudo olvidada");
            }}
            title="Olvidar la contraseña de sudo de esta conexión (la guardada no se borra)"
            aria-label="Olvidar la contraseña de sudo de esta conexión"
          >
            <LogOut size={14} />
          </button>
        )}
        <button className="icon-btn" onClick={onRefresh} disabled={disabled || busy} title="Recargar" aria-label="Recargar">
          <RefreshCw size={14} className={busy ? "adm-spin" : undefined} />
        </button>
      </div>
    </div>
  );
}

interface BannersProps {
  disabled: boolean;
  elevation: Elevation | null;
  elev: ElevationState;
  storedSudo: string | undefined;
  shadowError: string | null;
  tab: SubTab;
  onAskSudo: () => void;
}

export function AdminBanners({ disabled, elevation, elev, storedSudo, shadowError, tab, onAskSudo }: BannersProps) {
  return (
    <>
      {disabled && (
        <div className="adm-banner adm-banner-off" role="status">
          <Unplug size={14} /> Sin conexión: lo que ves puede estar desactualizado y no se pueden hacer cambios.
        </div>
      )}
      {!disabled && !elevation && storedSudo === "loading" && (
        <div className="adm-banner" role="status">
          <span className="spinner adm-spinner-btn" />
          <span className="adm-banner-text">Comprobando la contraseña de sudo guardada…</span>
        </div>
      )}
      {!disabled && !elevation && elev.readOnlyReason && storedSudo !== "loading" && (
        <div className="adm-banner" role="status">
          <ShieldAlert size={14} />
          <span className="adm-banner-text">{elev.readOnlyReason}</span>
          {elev.canAskSudo && (
            <button className="btn btn-sm btn-primary" onClick={onAskSudo}>
              <KeyRound size={13} /> Tengo sudo: introducir contraseña
            </button>
          )}
        </div>
      )}
      {!disabled && elevation && shadowError && NEEDS_READ.includes(tab) && (
        <div className="adm-banner adm-banner-warn" role="status">
          <ShieldAlert size={14} />
          <span className="adm-banner-text">No se pudo leer el estado de las contraseñas: {shadowError}</span>
          {elev.canAskSudo && (
            <button className="btn btn-sm" onClick={onAskSudo}>
              <KeyRound size={13} /> Introducir contraseña de sudo
            </button>
          )}
        </div>
      )}
    </>
  );
}
