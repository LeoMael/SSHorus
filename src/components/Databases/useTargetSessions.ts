// Estado de cada base abierta en la pestaña: entrar (probando sin contraseña o con la guardada), pedir
// usuario y contraseña si hace falta, la lista de bases y los esquemas ya leídos (con «Cancelar» si tarda).
// La forma de entrar que funcionó queda en memoria mientras la pestaña siga abierta.
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, isApiError } from "../../api/core";
import { dbCreds } from "../../api/db";
import { newExecId, snippets } from "../../api/snippets";
import { clipboard } from "../../lib/clipboard";
import { toast } from "../../stores/toasts";
import {
  DbAuthError,
  openTarget,
  openWith,
  readDdl,
  readSchema,
  type DbContext,
} from "../../features/databases/remote";
import type { DbAuth, DbList, DbSchema, DbTarget } from "../../features/databases";

export type SchemaLoad = { state: "loading"; execId: string } | { state: "ok"; schema: DbSchema } | { state: "error"; message: string };

export type TargetState =
  | { phase: "opening" }
  | { phase: "need-auth"; message: string }
  | { phase: "error"; message: string }
  | { phase: "open"; auth: DbAuth; list: DbList | null; database: string | null; schemas: Record<string, SchemaLoad> };

export function useTargetSessions(ctx: DbContext, profileId: string, onSavedChange: () => void) {
  const [states, setStates] = useState<Record<string, TargetState>>({});
  const statesRef = useRef(states);
  useEffect(() => {
    statesRef.current = states;
  }, [states]);

  const put = useCallback((key: string, s: TargetState | ((prev: TargetState | undefined) => TargetState)) => {
    setStates((all) => ({ ...all, [key]: typeof s === "function" ? s(all[key]) : s }));
  }, []);

  // Solo al empezar a cargar se elige esa base: si termina después de que eligieras otra, no te devuelve a ella.
  const setSchema = useCallback(
    (key: string, db: string, load: SchemaLoad) =>
      put(key, (prev) =>
        prev?.phase === "open"
          ? { ...prev, database: load.state === "loading" ? db : prev.database, schemas: { ...prev.schemas, [db]: load } }
          : (prev ?? { phase: "opening" }),
      ),
    [put],
  );

  const loadSchema = useCallback(
    async (t: DbTarget, auth: DbAuth, db: string) => {
      const execId = newExecId();
      setSchema(t.key, db, { state: "loading", execId });
      try {
        setSchema(t.key, db, { state: "ok", schema: await readSchema(ctx, t, auth, db, {}, { execId }) });
      } catch (e) {
        setSchema(t.key, db, { state: "error", message: isApiError(e, "Canceled") ? "Cancelado" : errorMessage(e) });
      }
    },
    [ctx, setSchema],
  );

  /** Abre con `auth` (lo que escribió el usuario) o probando las formas de entrar. */
  const open = useCallback(
    async (t: DbTarget, auth?: DbAuth): Promise<boolean> => {
      put(t.key, { phase: "opening" });
      try {
        const saved = auth ? null : await dbCreds.get(profileId, t.key).catch(() => null);
        const o = auth ? await openWith(ctx, t, auth) : await openTarget(ctx, t, saved);
        const schemas: Record<string, SchemaLoad> = o.schema ? { main: { state: "ok", schema: o.schema } } : {};
        const only = o.list?.databases.length === 1 ? o.list.databases[0].name : null;
        put(t.key, { phase: "open", auth: o.auth, list: o.list, database: o.schema ? "main" : only, schemas });
        if (only) void loadSchema(t, o.auth, only);
        return true;
      } catch (e) {
        if (e instanceof DbAuthError) put(t.key, { phase: "need-auth", message: e.message });
        else if (auth) put(t.key, { phase: "need-auth", message: errorMessage(e) });
        else put(t.key, { phase: "error", message: errorMessage(e) });
        return false;
      }
    },
    [ctx, profileId, put, loadSchema],
  );

  /** Entrar con usuario y contraseña; si sirve y se pidió, se guarda (bóveda o llavero). */
  const login = useCallback(
    async (t: DbTarget, user: string, password: string, save: boolean) => {
      const ok = await open(t, { kind: "password", user, password });
      if (ok && save) {
        try {
          await dbCreds.set(profileId, t.key, { user, password });
          onSavedChange();
        } catch (e) {
          toast.error("No se pudo guardar la contraseña", e);
        }
      }
      return ok;
    },
    [open, profileId, onSavedChange],
  );

  const forget = useCallback(
    async (t: DbTarget) => {
      try {
        await dbCreds.set(profileId, t.key, null);
        onSavedChange();
        toast.success("Contraseña olvidada", `Ya no se guarda la de «${t.label}».`);
      } catch (e) {
        toast.error("No se pudo olvidar la contraseña", e);
      }
    },
    [profileId, onSavedChange],
  );

  const pickDatabase = useCallback(
    (t: DbTarget, db: string, reload = false) => {
      const s = statesRef.current[t.key];
      if (s?.phase !== "open") return;
      const cached = s.schemas[db];
      if (!reload && cached && cached.state !== "error") {
        put(t.key, { ...s, database: db });
        return;
      }
      void loadSchema(t, s.auth, db);
    },
    [put, loadSchema],
  );

  const cancel = useCallback((t: DbTarget) => {
    const s = statesRef.current[t.key];
    const load = s?.phase === "open" && s.database ? s.schemas[s.database] : null;
    if (load?.state === "loading") void snippets.cancelExec(load.execId);
  }, []);

  const copyDdl = useCallback(
    async (t: DbTarget, schema: string, table: string) => {
      const s = statesRef.current[t.key];
      if (s?.phase !== "open" || !s.database) return;
      try {
        const ddl = await readDdl(ctx, t, s.auth, s.database, schema, table);
        await clipboard.write(ddl);
        toast.success("DDL copiado", `Definición de «${table}» en el portapapeles.`);
      } catch (e) {
        toast.error(`No se pudo leer el DDL de «${table}»`, e);
      }
    },
    [ctx],
  );

  return { states, open, login, forget, pickDatabase, cancel, copyDdl };
}

export type TargetSessions = ReturnType<typeof useTargetSessions>;
