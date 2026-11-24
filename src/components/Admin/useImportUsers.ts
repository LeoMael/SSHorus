// «Añadir a SSHorus»: lectura de los usuarios como root, llaves nuevas, guardado de los perfiles y prueba de conexión.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../api/core";
import { localkeys } from "../../api/localkeys";
import { ssh } from "../../api/ssh";
import type { ServerProfile, SessionInfo } from "../../api/types";
import {
  ElevationError,
  importedProfile,
  namesToRead,
  parseUserAccess,
  resolveImportBase,
  runScript,
  succeeded,
  failureText,
  userAccessScript,
  type AccessRead,
  type ImportBase,
  type ImportItem,
  type NewKey,
  type UserRow,
} from "../../features/admin";
import { refreshPrivilege, type Elevation } from "../../features/privileges";
import { describeTestOk, testServerConnection } from "../../features/connect/serverTest";
import { useLocalKeys } from "../../features/sshkeys/store";
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

/**
 * Servidor del que se copian host y puerto: el de la pestaña o, si no se encuentra, el de los datos de la
 * conexión (ver `resolveImportBase`). Carga la lista de servidores si aún no lo estaba.
 */
export function useImportBase(sessionId: string, profileId: string): { found: ImportBase | null; searching: boolean } {
  const loaded = useProfiles((s) => s.loaded);
  const servers = useProfiles((s) => s.servers);
  // undefined = aún no se preguntó al motor; null = no está esa conexión.
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined);
  const byId = servers.some((s) => s.id === profileId);

  useEffect(() => {
    if (!loaded) void useProfiles.getState().load();
  }, [loaded]);

  // Solo hace falta la conexión cuando el servidor de la pestaña no aparece.
  useEffect(() => {
    if (byId) return;
    let alive = true;
    ssh.listSessions().then(
      (list) => alive && setSession(list.find((s) => s.id === sessionId) ?? null),
      () => alive && setSession(null),
    );
    return () => {
      alive = false;
    };
  }, [byId, sessionId]);

  const found = useMemo(() => resolveImportBase(servers, profileId, session ?? null), [servers, profileId, session]);
  return { found, searching: !found && (!loaded || session === undefined) };
}

/**
 * Crea en ~/.ssh las llaves nuevas que faltan (`names`: grupo → nombre del archivo, sin frase) y vuelve
 * a leer ~/.ssh. Devuelve las creadas por grupo y, si alguna falló, el motivo.
 */
export async function createNewKeys(names: ReadonlyMap<string, string>, comment: string): Promise<{ created: Map<string, NewKey>; error: string | null }> {
  const created = new Map<string, NewKey>();
  let error: string | null = null;
  for (const [id, name] of names) {
    try {
      const k = await localkeys.generate(name, comment, "");
      created.set(id, { privatePath: k.privatePath, publicLine: k.publicLine });
    } catch (e) {
      error = `No se pudo crear la llave «${name}»: ${errorMessage(e)}`;
      break;
    }
  }
  if (created.size) await useLocalKeys.getState().reload();
  return { created, error };
}

/**
 * Guarda un servidor por usuario (con su contraseña, si la escribió) y lo añade a los mismos proyectos que `base`.
 * Muestra un aviso con el resumen. Devuelve los guardados.
 */
export async function saveImported(base: ServerProfile, items: readonly ImportItem[]): Promise<ServerProfile[]> {
  const st = useProfiles.getState();
  const projectIds = base.id ? st.projects.filter((p) => p.serverIds.includes(base.id)).map((p) => p.id) : [];
  const saved: ServerProfile[] = [];
  for (const it of items) {
    const s = await st.saveServer(importedProfile(base, it.user, it.name, it.auth), it.password || undefined);
    if (!s) continue;
    saved.push(s);
    for (const pid of projectIds) await useProfiles.getState().addServerToProject(pid, s.id);
  }
  const failed = items.length - saved.length;
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

/** Prueba la conexión de los servidores creados (con su contraseña guardada), uno tras otro. Se cancela al cerrar. */
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
      const out = await testServerConnection(s, { useSavedSecret: true }, (id) => (testId.current = id), stale);
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
