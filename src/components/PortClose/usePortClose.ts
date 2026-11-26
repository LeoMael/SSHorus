// Lee lo necesario para «Cerrar puerto» (cortafuegos, conexión SSH actual y contenedores de todos los
// dueños, con sudo si lo hay) y calcula las opciones. Vuelve a leer al cambiar la elevación.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../api/core";
import type { ListenPort, PortsResult } from "../../features/admin";
import { onJobFinished } from "../../features/jobs";
import { closeOptions, findOpener, PORT_CLOSE_JOB, readCloseContext, type CloseContext } from "../../features/portClose";
import { useElevation, usePrivilege, useStoredSudo } from "../../features/privileges";
import { useProfiles } from "../../stores/profiles";

export function usePortClose(sessionId: string, profileId: string, port: ListenPort, ports: PortsResult | null) {
  const info = usePrivilege(sessionId);
  const elev = useElevation(sessionId, info);
  useStoredSudo(sessionId, profileId, info, !!sessionId);
  const profilePort = useProfiles((s) => s.servers.find((x) => x.id === profileId)?.port ?? 22);
  const me = info?.user ?? null;
  const isRoot = info?.level === "root";
  const elevation = elev.elevation;

  const [ctx, setCtx] = useState<CloseContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);

  const load = useCallback(async () => {
    const g = ++gen.current;
    setLoading(true);
    setError(null);
    try {
      const r = await readCloseContext(sessionId, { elevation, profilePort, ports, me, isRoot });
      if (g === gen.current) setCtx(r);
    } catch (e) {
      if (g === gen.current) setError(errorMessage(e));
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [sessionId, elevation, profilePort, ports, me, isRoot]);

  useEffect(() => {
    void load();
  }, [load]);

  const plan = useMemo(() => {
    if (!ctx) return null;
    const opener = findOpener(port, ctx.containers, ctx.guard.ports);
    return closeOptions({ port, opener, firewall: ctx.firewall, firewallError: ctx.firewallError, sshPorts: ctx.guard.ports, me });
  }, [ctx, port, me]);

  return { plan, loading, error, elev, info };
}

/** Llama a `cb` cuando termina una tarea de «Cerrar puerto» en esa conexión (p. ej. para releer los puertos). */
export function usePortCloseFinished(sessionId: string, cb: () => void) {
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  useEffect(
    () =>
      onJobFinished((j) => {
        if (j.kind === PORT_CLOSE_JOB && j.sessionId === sessionId) ref.current();
      }),
    [sessionId],
  );
}
