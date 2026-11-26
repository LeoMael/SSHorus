// Motor elegido y de qué usuario(s) se ven los contenedores, con la elevación que necesita cada uno.
// Con root o sudo, el selector «Usuario» deja ver los contenedores de root y de cada usuario (Podman
// rootless, o Docker rootless), uno a uno o todos juntos.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  OWNER_ALL,
  OWNER_SELF,
  elevationPrefix,
  findOwner,
  loadEngine,
  loadOwnerChoice,
  ownerKey,
  ownerName,
  ownerOptions,
  saveEngine,
  saveOwnerChoice,
  type CtOwner,
  type DetectResult,
  type Engine,
  type EngineStatus,
  type OwnerRunner,
  loadStoreUsers,
  useStoreUsers,
} from "../../features/containers";
import {
  type Elevation,
  type ElevationState,
  type PrivilegeInfo,
  sudoRejected,
  ElevationError,
} from "../../features/privileges";
import { errorMessage } from "../../api/core";
import { NO_ELEVATION, pickStatus, selfOwnerLabel } from "../../features/containers/panelLogic";
import { useOwnerNav } from "../../features/containers/ownerNav";

interface Args {
  sessionId: string;
  profileId: string;
  info: PrivilegeInfo | null;
  elev: ElevationState;
  result: DetectResult | null;
  active: boolean;
  disabled: boolean;
  /** Abre el diálogo de la contraseña de sudo. */
  askSudo: () => void;
}

export function useOwnerScope({ sessionId, profileId, info, elev, result, active, disabled, askSudo }: Args) {
  const [enginePref, setEnginePref] = useState<Engine | null>(() => loadEngine(profileId));
  /** Selector «Usuario»: "self", "root", "u:<usuario>" o "all". */
  const [choice, setChoice] = useState(() => loadOwnerChoice(profileId));
  // «Ver en Contenedores» desde el Monitor: los contenedores de ese dueño.
  const ownerNav = useOwnerNav((s) => s.request);
  useEffect(() => {
    if (ownerNav?.sessionId !== sessionId) return;
    useOwnerNav.getState().done(ownerNav.seq);
    setChoice(ownerNav.owner);
    saveOwnerChoice(profileId, ownerNav.owner);
  }, [ownerNav, sessionId, profileId]);
  // Usuarios con contenedores propios: la misma lista (y el mismo script) que el escáner.
  const usersView = useStoreUsers((s) => s.bySession[sessionId] ?? null);
  const [usersLoad, setUsersLoad] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });

  const available: EngineStatus[] = useMemo(
    () => [result?.podman, result?.docker].filter((x): x is EngineStatus => !!x),
    [result],
  );
  const status = pickStatus(available, enginePref);
  const engine = status?.engine ?? "podman";

  const isRoot = result?.uid === 0 || info?.level === "root";
  const me = info?.user ?? null;
  /** Se puede ver lo de root y de otros usuarios (con root o sudo). */
  const canElevate = isRoot || info?.level === "sudo-nopasswd" || !!info?.hasSudo;
  /** Elevación para root y los demás usuarios (null = falta la contraseña de sudo). */
  const otherEl: Elevation | null = isRoot ? NO_ELEVATION : elev.elevation;
  /** Docker sin permiso sobre el socket: «tú» también necesita sudo. */
  const dockerSelfSudo = engine === "docker" && !!status?.needsSudo && !isRoot;
  const selfEl: Elevation | null = dockerSelfSudo ? elev.elevation : NO_ELEVATION;
  const selfLabel = selfOwnerLabel({ isRoot, engine, rootless: !!status?.rootless, me });

  const options = useMemo(
    () => ownerOptions({ engine, users: usersView?.users ?? [], me, isRoot }),
    [engine, usersView, me, isRoot],
  );
  const effChoice = canElevate ? choice : OWNER_SELF;
  const all = effChoice === OWNER_ALL && options.length > 1;
  // Un usuario (o «Todos») elegido antes, mientras se lee la lista de usuarios.
  const waitingUsers = (effChoice === OWNER_ALL || effChoice.startsWith("u:")) && !usersView && !usersLoad.error && canElevate;
  const current: CtOwner | null = all ? null : (findOwner(options, effChoice) ?? (waitingUsers ? null : { kind: "self" }));
  const activeOwners: CtOwner[] = useMemo(
    () => (all ? options.filter((o) => o.kind !== "self" || !!status?.accessible || dockerSelfSudo) : current ? [current] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, options, status?.accessible, dockerSelfSudo, current && ownerKey(current)],
  );
  const currentKey = current ? ownerKey(current) : OWNER_SELF;

  const needsSudo =
    !!status && !isRoot && (waitingUsers || activeOwners.some((o) => o.kind !== "self" || dockerSelfSudo) || (!current && !all));
  const elevation: Elevation | null = useMemo(() => (needsSudo ? elev.elevation : NO_ELEVATION), [needsSudo, elev.elevation]);
  const elevPrefix = isRoot ? "" : elev.elevation ? elevationPrefix(elev.elevation) : "sudo ";
  const selfPrefix = dockerSelfSudo ? elevPrefix : "";
  const prefix = current?.kind === "self" ? selfPrefix : elevPrefix;
  const runnable = !!status && !!elevation && !disabled && !waitingUsers && activeOwners.length > 0 && (status.accessible || needsSudo);
  const engineKey = `${engine}|${all ? OWNER_ALL : current ? currentKey : "?"}|${activeOwners.map(ownerKey).join(",")}|${elevation?.kind ?? "none"}`;

  const label = useCallback((o: CtOwner) => ownerName(o, selfLabel), [selfLabel]);
  const resolve = useCallback((k: string) => findOwner(options, k), [options]);
  const runner: OwnerRunner = useMemo(
    () => ({
      sessionId,
      engine,
      fallback: currentKey,
      resolve,
      elevationFor: (o: CtOwner) => (o.kind === "self" ? selfEl : otherEl),
      label,
    }),
    [sessionId, engine, currentKey, resolve, selfEl, otherEl, label],
  );

  const loadUsers = useCallback(async () => {
    if (!otherEl) return;
    setUsersLoad({ loading: true, error: null });
    try {
      await loadStoreUsers(sessionId, otherEl);
      setUsersLoad({ loading: false, error: null });
    } catch (e) {
      if (e instanceof ElevationError) {
        if (e.failure === "bad-password") sudoRejected(sessionId);
        if (e.failure === "bad-password" || e.failure === "need-password") askSudo();
      }
      setUsersLoad({ loading: false, error: errorMessage(e) });
    }
  }, [sessionId, otherEl, askSudo]);

  // Con root o sudo (ya con contraseña), se buscan una vez los usuarios con contenedores propios.
  useEffect(() => {
    if (!active || disabled || !status || !canElevate || !otherEl || usersView || usersLoad.loading || usersLoad.error) return;
    void loadUsers();
  }, [active, disabled, status, canElevate, otherEl, usersView, usersLoad.loading, usersLoad.error, loadUsers]);

  /** «Volver a detectar» (o activar linger) vuelve a buscar los usuarios si ya se buscaron o fallaron. */
  const reloadUsersIfLoaded = useCallback(() => {
    if (canElevate && otherEl && (usersView || usersLoad.error)) void loadUsers();
  }, [canElevate, otherEl, usersView, usersLoad.error, loadUsers]);

  const chooseEngine = (e: Engine) => {
    setEnginePref(e);
    saveEngine(profileId, e);
  };
  const chooseOwner = (v: string) => {
    setChoice(v);
    saveOwnerChoice(profileId, v);
  };

  return {
    available,
    status,
    engine,
    chooseEngine,
    isRoot,
    me,
    canElevate,
    dockerSelfSudo,
    options,
    effChoice,
    chooseOwner,
    all,
    waitingUsers,
    current,
    currentKey,
    activeOwners,
    usersLoad,
    reloadUsersIfLoaded,
    needsSudo,
    elevation,
    otherEl,
    elevPrefix,
    selfPrefix,
    prefix,
    runnable,
    engineKey,
    label,
    resolve,
    runner,
  };
}

export type OwnerScope = ReturnType<typeof useOwnerScope>;
