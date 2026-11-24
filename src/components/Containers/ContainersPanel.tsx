// Pestaña «Contenedores» de una conexión: administrador visual de Podman / Docker.
// Detecta el motor, decide si hace falta sudo y reparte el trabajo entre sub-pestañas
// (Contenedores, Imágenes, Volúmenes, Redes, Compose, Limpieza). Todo por el canal exec.
// Con root o sudo, el selector «Usuario» deja ver los contenedores de root y de cada usuario (Podman
// rootless, o Docker rootless), uno a uno o todos juntos; cada acción se ejecuta como el dueño.
import { useMemo, useState } from "react";
import { Boxes, RefreshCw, ShieldAlert } from "lucide-react";
import { ownerIsRoot, perOwner } from "../../features/containers";
import { usePrivilege, useElevation, useStoredSudo } from "../../features/privileges";
import { CtContext, type CtContextValue } from "./context";
import { NoEngine } from "./NoEngine";
import { EngineHeader } from "./EngineHeader";
import { EngineBanner } from "./EngineBanner";
import { LingerBanner } from "./LingerBanner";
import { RootStorageBanner } from "./RootStorageBanner";
import { SubTabBar, SubTabBody } from "./PanelSections";
import { PanelDialogs, usePanelDialogs } from "./PanelDialogs";
import type { SubTab } from "./panelLogic";
import { useEngineDetect } from "./useEngineDetect";
import { useOwnerScope } from "./useOwnerScope";
import { useResources } from "./useResources";
import { useEngineActions } from "./useEngineActions";
import { useAutostart } from "./useAutostart";
import "./Containers.css";

export interface ContainersPanelProps {
  sessionId: string;
  profileId: string;
  /** La pestaña se ve. */
  active: boolean;
  /** Sin conexión. */
  disabled: boolean;
}

export function ContainersPanel({ sessionId, profileId, active, disabled }: ContainersPanelProps) {
  const info = usePrivilege(sessionId);
  const elev = useElevation(sessionId, info);
  useStoredSudo(sessionId, profileId, info, active && !disabled);

  const dialogs = usePanelDialogs(sessionId, active, disabled);
  const { askSudo } = dialogs;
  const { det, detect } = useEngineDetect(sessionId, active, disabled);
  const result = det.result;
  const scope = useOwnerScope({ sessionId, profileId, info, elev, result, active, disabled, askSudo });
  const { status, engine, elevation, needsSudo, prefix, activeOwners, all, currentKey, resolve, isRoot } = scope;

  const [tab, setTab] = useState<SubTab>("containers");
  const { res, stats, reload, ownerErrors } = useResources({ ...scope, active, tab, askSudo });
  const actions = useEngineActions({ ...scope, sessionId, runuser: !!result?.runuser, reload, askSudo });
  const { run, runRawAs, toTerminal, render, ownerLabel } = actions;
  const { setReview, setLogs, setInspectC, setRunForm } = dialogs;
  const autostart = useAutostart({
    engine,
    owners: activeOwners,
    status: status ?? null,
    active,
    containers: res.containers.data,
    runRawAs,
    isRoot,
  });

  const ctx: CtContextValue | null = useMemo(() => {
    if (!status || !result) return null;
    return {
      sessionId,
      profileId,
      disabled,
      active,
      engine,
      status,
      detect: result,
      composeTools: status.compose,
      elevation,
      needsSudo,
      prefix,
      res,
      stats,
      reload,
      run,
      runRawAs,
      review: setReview,
      askSudo,
      openLogs: setLogs,
      openInspect: setInspectC,
      openRunForm: (prefill, owner) => setRunForm({ prefill, owner }),
      toTerminal,
      render,
      owners: activeOwners,
      allOwners: all,
      newOwner: all ? null : currentKey,
      ownerLabel,
      ownerIsRoot: (k) => {
        const o = resolve(k ?? currentKey);
        return !!o && ownerIsRoot(o, isRoot);
      },
      perOwner: (items, build) => perOwner(items, currentKey, build),
      autostart,
      reloadUsers: scope.reloadUsersIfLoaded,
    };
  }, [
    status,
    result,
    sessionId,
    profileId,
    disabled,
    active,
    engine,
    elevation,
    needsSudo,
    prefix,
    res,
    stats,
    reload,
    run,
    runRawAs,
    toTerminal,
    render,
    activeOwners,
    all,
    currentKey,
    ownerLabel,
    resolve,
    isRoot,
    askSudo,
    setReview,
    setLogs,
    setInspectC,
    setRunForm,
    autostart,
    scope.reloadUsersIfLoaded,
  ]);

  // ───────── Render ─────────
  if (!result) {
    return (
      <div className="ct-root">
        <div className="empty-state">
          {disabled ? (
            <>
              <Boxes size={28} />
              <div>Sin conexión con el servidor</div>
            </>
          ) : det.error ? (
            <>
              <ShieldAlert size={28} />
              <div>{det.error}</div>
              <button className="btn btn-sm" onClick={() => void detect()} disabled={disabled}>
                <RefreshCw size={13} /> Reintentar
              </button>
            </>
          ) : (
            <>
              <span className="spinner" />
              <div>Buscando Podman y Docker en el servidor…</div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!status || !ctx) {
    return (
      <div className="ct-root">
        <NoEngine info={info} dockerIsShim={result.dockerIsShim} onRetry={() => void detect()} busy={det.loading} sessionId={sessionId} />
      </div>
    );
  }

  return (
    <CtContext.Provider value={ctx}>
      <div className="ct-root">
        <EngineHeader
          scope={scope}
          status={status}
          elevLabel={elev.label}
          detecting={det.loading}
          disabled={disabled}
          onRedetect={() => {
            void detect();
            scope.reloadUsersIfLoaded();
          }}
        />
        <EngineBanner
          scope={scope}
          status={status}
          result={result}
          info={info}
          elev={elev}
          askSudo={askSudo}
          review={setReview}
          detect={detect}
        />
        <RootStorageBanner scope={scope} status={status} ownerErrors={ownerErrors} runRawAs={runRawAs} review={setReview} detect={detect} />
        <LingerBanner scope={scope} review={setReview} onLingerEnabled={() => void autostart.reload()} />
        <SubTabBar tab={tab} setTab={setTab} res={res} />
        <SubTabBody
          tab={tab}
          runnable={scope.runnable}
          sudoMissing={needsSudo && !elevation}
          waitingUsers={scope.waitingUsers}
          problem={status.problem}
        />
        <PanelDialogs
          dialogs={dialogs}
          actions={actions}
          runner={scope.runner}
          sessionId={sessionId}
          profileId={profileId}
          user={info?.user ?? null}
          disabled={disabled}
        />
      </div>
    </CtContext.Provider>
  );
}
