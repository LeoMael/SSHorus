// Contenido de la sub-pestaña elegida de Administración. Las que necesitan usuarios y grupos esperan a
// la lectura del servidor (o enseñan por qué falló).
import { Suspense } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { preloadable } from "../../lib/lazy";
import { NEEDS_READ, type SubTab } from "./AdminChrome";
import { UsersTab } from "./users/UsersTab";
import { GroupsTab } from "./users/GroupsTab";
import { SessionsTab } from "./users/SessionsTab";
import { HistoryTab } from "./HistoryTab";
import { PortsTab } from "./web/PortsTab";
import { WebTab } from "./web/WebTab";
import { VulnsTab } from "./vulns/VulnsTab";
import { AuditTab } from "./audit/AuditTab";
import { VisibilityTab } from "./visibility/VisibilityTab";
import { ConfigTab } from "./config/ConfigTab";
import { ServicesTab } from "./services/ServicesTab";
import { PackagesTab } from "./packages/PackagesTab";
import { TasksTab } from "./tasks/TasksTab";

const ServerMap = preloadable(() => import("../InfraMap/ServerMap").then((m) => m.ServerMap));

export function AdminBody({
  tab,
  setTab,
  sessionId,
  profileId,
  active,
  disabled,
  hasRead,
  error,
  onRetry,
}: {
  tab: SubTab;
  setTab: (t: SubTab) => void;
  sessionId: string;
  profileId: string;
  active: boolean;
  disabled: boolean;
  /** Ya se leyeron usuarios y grupos. */
  hasRead: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const waitsRead = !hasRead && NEEDS_READ.includes(tab);
  return (
    <div className="adm-body" id={`adm-panel-${sessionId}`} role="tabpanel" aria-labelledby={`adm-tab-${sessionId}-${tab}`}>
      {tab === "map" ? (
        <Suspense fallback={<div className="empty-state"><span className="spinner" /></div>}>
          <ServerMap sessionId={sessionId} profileId={profileId} active={active} disabled={disabled} />
        </Suspense>
      ) : tab === "vulns" ? (
        <VulnsTab />
      ) : tab === "audit" ? (
        <AuditTab onOpenVulns={() => setTab("vulns")} onOpenVisibility={() => setTab("visibility")} />
      ) : tab === "config" ? (
        <ConfigTab onOpenMap={() => setTab("map")} onOpenUsers={() => setTab("users")} />
      ) : tab === "visibility" ? (
        <VisibilityTab />
      ) : tab === "ports" ? (
        <PortsTab />
      ) : tab === "web" ? (
        <WebTab />
      ) : tab === "services" ? (
        <ServicesTab />
      ) : tab === "packages" ? (
        <PackagesTab onOpenServices={() => setTab("services")} />
      ) : tab === "tasks" ? (
        <TasksTab />
      ) : error && waitsRead ? (
        <div className="empty-state">
          <ShieldAlert size={22} />
          <div>No se pudo leer la información del servidor</div>
          <div className="faint adm-pre-wrap">{error}</div>
          <button className="btn btn-sm" onClick={onRetry} disabled={disabled}>
            <RefreshCw size={13} /> Reintentar
          </button>
        </div>
      ) : waitsRead ? (
        <div className="empty-state">
          <span className="spinner" />
          <div>Leyendo usuarios y grupos…</div>
        </div>
      ) : tab === "users" ? (
        <UsersTab onOpenVisibility={() => setTab("visibility")} />
      ) : tab === "groups" ? (
        <GroupsTab />
      ) : tab === "sessions" ? (
        <SessionsTab />
      ) : (
        <HistoryTab />
      )}
    </div>
  );
}
