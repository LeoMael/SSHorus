// «Añadir a SSHorus»: lectura de los usuarios como root, guardado de los perfiles y prueba de conexión.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../api/core";
import { localkeys, type LocalPublicKey } from "../../api/localkeys";
import { ssh } from "../../api/ssh";
import type { ServerProfile } from "../../api/types";
import {
  ElevationError,
  importedProfile,
  namesToRead,
  parseUserAccess,
  runScript,
  succeeded,
  failureText,
  userAccessScript,
  type AccessRead,
  type ImportAuth,
  type UserRow,
} from "../../features/admin";
import { refreshPrivilege, type Elevation } from "../../features/privileges";
import { describeTestOk, testServerConnection } from "../../features/serverTest";
import { useProfiles } from "../../stores/profiles";
import { toast } from "../../stores/toasts";

export interface AccessState {
  read: AccessRead | null;
  loading: boolean;
  error: string | null;
  /** Falta la contraseña de sudo (o era incorrecta). */
  needSudo: boolean;
}

/** Llaves, sudo y estado de la contraseña de los usuarios que pueden entrar (como root). */
export function useUserAccess(sessionId: string, elevation: Elevation | null, users: readonly UserRow[]): AccessState & { reload: () => void } {
  const [state, setState] = useState<AccessState>({ read: null, loading: false, error: null, needSudo: false });
  const names = useMemo(() => namesToRead(users), [users]);
  const key = names.join("\n");
  const gen = useRef(0);

  const load = useCallback(async () => {
    const g = ++gen.current;
    if (!elevation || elevation.kind === "none") {
      setState({ read: null, loading: false, error: "Necesitas root o sudo para ver sus llaves y contraseñas", needSudo: true });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null, needSudo: false }));
    try {
      const r = await runScript(sessionId, userAccessScript(key ? key.split("\n") : []), elevation, "", 30);
      if (g !== gen.current) return;
      if (!succeeded(r)) throw new Error(failureText(r));
      setState({ read: parseUserAccess(r.stdout), loading: false, error: null, needSudo: false });
    } catch (e) {
      if (g !== gen.current) return;
      const needSudo = e instanceof ElevationError && (e.failure === "need-password" || e.failure === "bad-password");
      if (e instanceof ElevationError && e.failure === "need-password") refreshPrivilege(sessionId);
      setState({ read: null, loading: false, error: errorMessage(e), needSudo });
    }
  }, [sessionId, elevation, key]);

  useEffect(() => {
    void load();
  }, [load]);
  return { ...state, reload: () => void load() };
}

/** Llaves públicas de ~/.ssh de este equipo (null mientras se leen). */
export function useLocalKeys(): LocalPublicKey[] | null {
  const [locals, setLocals] = useState<LocalPublicKey[] | null>(null);
  useEffect(() => {
    let alive = true;
    localkeys.listPublic().then(
      (l) => alive && setLocals(l),
      () => alive && setLocals([]),
    );
    return () => {
      alive = false;
    };
  }, []);
  return locals;
}

/**
 * Guarda un servidor por usuario (sin secretos) y lo añade a los mismos proyectos que `base`.
 * Muestra un aviso con el resumen. Devuelve los guardados.
 */
export async function saveImported(base: ServerProfile, names: readonly string[], auth: ImportAuth): Promise<ServerProfile[]> {
  const st = useProfiles.getState();
  const projectIds = st.projects.filter((p) => p.serverIds.includes(base.id)).map((p) => p.id);
  const saved: ServerProfile[] = [];
  for (const n of names) {
    const s = await st.saveServer(importedProfile(base, n, auth));
    if (!s) continue;
    saved.push(s);
    for (const pid of projectIds) await useProfiles.getState().addServerToProject(pid, s.id);
  }
  const failed = names.length - saved.length;
  if (saved.length) {
    const list = saved.map((s) => s.username).join(", ");
    toast.success(
      saved.length === 1 ? "Servidor añadido a SSHorus" : `${saved.length} servidores añadidos a SSHorus`,
      failed ? `${list} · ${failed} no se pudieron guardar` : list,
    );
  }
  return saved;
}

export type TestState = { status: "idle" } | { status: "running" } | { status: "ok" | "error"; message: string };

/** Prueba la conexión de los servidores creados, uno tras otro. Se cancela al cerrar. */
export function useConnectionTests(servers: readonly ServerProfile[]) {
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const testId = useRef<string | null>(null);
  // Cada tanda tiene su número: cerrar (o empezar otra) deja obsoleta la anterior.
  const run = useRef(0);

  useEffect(
    () => () => {
      run.current++;
      if (testId.current) void ssh.cancelTest(testId.current).catch(() => {});
    },
    [],
  );

  const set = (id: string, t: TestState) => setTests((x) => ({ ...x, [id]: t }));

  const runAll = useCallback(async () => {
    const r = ++run.current;
    const stale = () => r !== run.current;
    for (const s of servers) {
      if (stale()) return;
      set(s.id, { status: "running" });
      const out = await testServerConnection(s, {}, (id) => (testId.current = id), stale);
      testId.current = null;
      if (stale()) return;
      if (out.status === "ok") set(s.id, { status: "ok", message: describeTestOk(out.result, s.auth) });
      else if (out.status === "error") set(s.id, { status: "error", message: out.message });
      else set(s.id, { status: "idle" });
    }
  }, [servers]);

  const running = Object.values(tests).some((t) => t.status === "running");
  return { tests, runAll, running };
}
