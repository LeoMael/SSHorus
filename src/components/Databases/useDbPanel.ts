// Pestaña «Bases de datos»: buscar los destinos del servidor (la primera vez que se ve, al reconectar o al
// cambiar la elevación), los SQLite añadidos a mano, cuál está elegido y qué credenciales hay guardadas.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../api/core";
import { dbCreds } from "../../api/db";
import { useProfiles } from "../../stores/profiles";
import { promptDialog } from "../ui/dialogs";
import { usePrivilege, useElevation, useStoredSudo } from "../../features/privileges";
import { sqliteTarget } from "../../features/databases/discover";
import { discoverDatabases, type DbContext } from "../../features/databases/remote";
import { loadSqlitePaths, saveSqlitePaths, useDbDiscovery } from "../../features/databases/store";

interface Args {
  sessionId: string;
  profileId: string;
  active: boolean;
  disabled: boolean;
}

function validatePath(p: string): string | null {
  if (!p.trim().startsWith("/")) return "Escribe la ruta completa en el servidor (empieza por /)";
  if (/[\n\r]/.test(p)) return "La ruta no puede tener saltos de línea";
  return null;
}

export function useDbPanel({ sessionId, profileId, active, disabled }: Args) {
  const info = usePrivilege(sessionId);
  const elev = useElevation(sessionId, info);
  useStoredSudo(sessionId, profileId, info, active && !disabled);
  const sshPort = useProfiles((s) => s.servers.find((x) => x.id === profileId)?.port ?? 22);
  const discovery = useDbDiscovery((s) => s.discovery[sessionId] ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState(() => loadSqlitePaths(profileId));
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const gen = useRef(0);

  const elevation = elev.elevation;
  const ctx: DbContext = useMemo(() => ({ sessionId, elevation }), [sessionId, elevation]);

  const refreshSaved = useCallback(() => {
    dbCreds.targets(profileId).then(
      (keys) => setSaved(new Set(keys)),
      () => setSaved(new Set()),
    );
  }, [profileId]);

  const discover = useCallback(async () => {
    if (!info) return;
    const g = ++gen.current;
    setLoading(true);
    setError(null);
    try {
      const d = await discoverDatabases(sessionId, { elevation, me: info.user, isRoot: info.level === "root", sshPort });
      if (g === gen.current) useDbDiscovery.getState().setDiscovery(sessionId, d);
    } catch (e) {
      if (g === gen.current) setError(errorMessage(e));
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [sessionId, elevation, info, sshPort]);

  // Volver a buscar al reconectar o al cambiar la elevación (p. ej. tras escribir la contraseña de sudo).
  const [stale, setStale] = useState(true);
  const elevKey = elevation?.kind ?? "none";
  useEffect(() => setStale(true), [elevKey, disabled]);
  useEffect(() => {
    if (!active || disabled || !info || !stale) return;
    setStale(false);
    refreshSaved();
    void discover();
  }, [active, disabled, info, stale, discover, refreshSaved]);

  const targets = useMemo(() => {
    const tools = discovery ? new Set(discovery.tools) : null;
    return [...(discovery?.targets ?? []), ...files.map((p) => sqliteTarget(p, tools))];
  }, [discovery, files]);
  const current = targets.find((t) => t.key === selected) ?? null;

  const addSqlite = async () => {
    const path = await promptDialog({
      title: "Abrir un archivo SQLite",
      message: "SSHorus no busca por el disco: escribe dónde está el archivo en el servidor. Se abre en solo lectura.",
      label: "Ruta en el servidor",
      placeholder: "/srv/app/datos.db",
      confirmText: "Abrir",
      validate: validatePath,
    });
    const p = path?.trim();
    if (!p) return;
    const next = files.includes(p) ? files : [p, ...files];
    setFiles(next);
    saveSqlitePaths(profileId, next);
    setSelected(`sqlite@${p}`);
  };

  const removeSqlite = (path: string) => {
    const next = files.filter((f) => f !== path);
    setFiles(next);
    saveSqlitePaths(profileId, next);
    if (selected === `sqlite@${path}`) setSelected(null);
  };

  return { info, elev, ctx, discovery, loading, error, discover, targets, current, select: setSelected, addSqlite, removeSqlite, saved, refreshSaved };
}

export type DbPanelState = ReturnType<typeof useDbPanel>;
