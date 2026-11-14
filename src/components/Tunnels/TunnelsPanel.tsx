// Túneles (port forwarding) del servidor: explicación, lista con interruptor y estado en vivo, editor y
// «Servicios que puedes traer».
// El motor arranca los "automáticos" al conectar, los rehace al reconectar y los para al cerrar.
import { useCallback, useEffect, useState } from "react";
import { Cable, Plus } from "lucide-react";
import { errorMessage, isApiError } from "../../api/core";
import { tunnels, type TunnelDef, type TunnelStatus } from "../../api/tunnels";
import { clipboard } from "../../lib/clipboard";
import { toast } from "../../stores/toasts";
import { confirmDialog } from "../ui/dialogs";
import {
  ensureTunnelEvents,
  isTunnelOn,
  TUNNEL_TEMPLATES,
  tunnelAddress,
  useTunnels,
  type TunnelTemplate,
} from "../../features/tunnels/useTunnels";
import { ServicesSection } from "./ServicesSection";
import { TunnelDialog } from "./TunnelDialog";
import { TunnelRow } from "./TunnelRow";
import "./Tunnels.css";

export interface TunnelsPanelProps {
  sessionId: string;
  profileId: string;
  /** La pestaña se ve. */
  active: boolean;
  /** Sin conexión. */
  disabled: boolean;
}

const NO_STATUS: Record<string, TunnelStatus> = {};

function blank(profileId: string, t?: TunnelTemplate): TunnelDef {
  return {
    id: "",
    profileId,
    name: t?.name ?? "",
    kind: t?.kind ?? "local",
    bindHost: "127.0.0.1",
    bindPort: t?.port ?? 0,
    destHost: t?.kind === "socks" ? "" : "127.0.0.1",
    destPort: t && t.kind !== "socks" ? t.port : 0,
    autoStart: false,
  };
}

export function TunnelsPanel({ sessionId, profileId, active, disabled }: TunnelsPanelProps) {
  const defs = useTunnels((s) => s.defs[profileId]);
  const statusMap = useTunnels((s) => s.status[sessionId]) ?? NO_STATUS;
  const [editing, setEditing] = useState<TunnelDef | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => ensureTunnelEvents(), []);

  useEffect(() => {
    setLoadError(null);
    useTunnels
      .getState()
      .loadDefs(profileId)
      .catch((e) => setLoadError(errorMessage(e)));
  }, [profileId]);

  // Sincronizar al mostrarse y al conectar/reconectar (los eventos cubren el resto).
  useEffect(() => {
    if (!active) return;
    useTunnels
      .getState()
      .loadStatus(sessionId)
      .catch(() => {});
  }, [sessionId, active, disabled]);

  const setBusyFor = (id: string, v: boolean) => setBusy((b) => ({ ...b, [id]: v }));

  const start = useCallback(
    async (def: TunnelDef) => {
      setBusyFor(def.id, true);
      try {
        useTunnels.getState().applyStatus(await tunnels.start(sessionId, def.id));
      } catch (e) {
        if (!isApiError(e, "Canceled")) toast.error(`No se pudo activar «${def.name}»`, e);
        useTunnels.getState().loadStatus(sessionId).catch(() => {});
      } finally {
        setBusyFor(def.id, false);
      }
    },
    [sessionId],
  );

  const stop = useCallback(
    async (def: TunnelDef) => {
      setBusyFor(def.id, true);
      try {
        await tunnels.stop(sessionId, def.id);
        useTunnels.getState().loadStatus(sessionId).catch(() => {});
      } catch (e) {
        toast.error(`No se pudo parar «${def.name}»`, e);
      } finally {
        setBusyFor(def.id, false);
      }
    },
    [sessionId],
  );

  const remove = async (def: TunnelDef) => {
    const ok = await confirmDialog({
      title: `¿Borrar el túnel «${def.name}»?`,
      message: isTunnelOn(statusMap[def.id]) ? "Está activo: se cerrará y se cortarán sus conexiones." : undefined,
      confirmText: "Borrar",
      danger: true,
    });
    if (!ok) return;
    try {
      await useTunnels.getState().remove(def);
    } catch (e) {
      toast.error("No se pudo borrar el túnel", e);
    }
  };

  const copy = async (def: TunnelDef) => {
    const addr = tunnelAddress(def, statusMap[def.id]);
    try {
      await clipboard.write(addr);
      toast.success("Dirección copiada", addr);
    } catch (e) {
      toast.error("No se pudo copiar", e);
    }
  };

  const save = async (def: TunnelDef, activate: boolean) => {
    const saved = await useTunnels.getState().save(def);
    setEditing(null);
    if (activate && !disabled) await start(saved);
  };

  const list = defs ?? [];

  return (
    <div className="tn-panel">
      <div className="tn-header">
        <span className="section-label">Túneles</span>
        <button className="btn btn-sm btn-primary" onClick={() => setEditing(blank(profileId))}>
          <Plus size={14} /> Nuevo túnel
        </button>
      </div>

      {disabled && <div className="tn-banner">Sin conexión: los túneles se activan cuando el servidor está conectado.</div>}
      {loadError && <div className="tn-banner tn-banner-error">{loadError}</div>}

      <div className="tn-body">
        <p className="tn-intro">
          Un túnel trae un servicio del servidor a tu equipo. Ejemplo: la base de datos PostgreSQL del servidor
          aparece en tu PC como <span className="mono">localhost:5432</span> y la abres con DBeaver o pgAdmin, sin
          abrir puertos en internet.
        </p>
        {defs === undefined && !loadError ? (
          <div className="tn-loading">
            <div className="spinner" />
          </div>
        ) : list.length === 0 ? (
          <div className="tn-empty">
            <Cable size={20} />
            <p className="tn-empty-text">Aún no tienes túneles. Trae un servicio de la lista de abajo o crea uno a mano:</p>
            <div className="tn-templates tn-templates-center">
              {TUNNEL_TEMPLATES.map((t) => (
                <button key={t.label} className="tn-chip" onClick={() => setEditing(blank(profileId, t))}>
                  {t.label} <span className="tn-chip-port">{t.port}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="tn-list">
            {list.map((def) => (
              <TunnelRow
                key={def.id}
                def={def}
                st={statusMap[def.id]}
                pending={!!busy[def.id]}
                disabled={disabled}
                start={start}
                stop={stop}
                copy={copy}
                onEdit={setEditing}
                remove={remove}
              />
            ))}
          </ul>
        )}

        <ServicesSection sessionId={sessionId} profileId={profileId} active={active} disabled={disabled} />
      </div>

      {editing && (
        <TunnelDialog
          initial={editing}
          canActivate={!disabled && !isTunnelOn(statusMap[editing.id])}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}
