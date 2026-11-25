// Diálogos del panel de Contenedores (registros, inspeccionar, crear, revisar comandos y sudo) y su estado.
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { ownedFullScript, type Container, type OwnerRunner, type RunForm } from "../../features/containers";
import type { CtJob } from "../../features/containers/jobs";
import { useStoredSudoState } from "../../features/privileges";
import { SudoDialog } from "../Admin/SudoDialog";
import type { LogsTarget, ReviewRequest } from "./context";
import { ReviewDialog } from "./ReviewDialog";
import type { EngineActions } from "./useEngineActions";

const LogsDialog = lazy(() => import("./LogsDialog").then((m) => ({ default: m.LogsDialog })));
const InspectDialog = lazy(() => import("./InspectDialog").then((m) => ({ default: m.InspectDialog })));
const RunDialog = lazy(() => import("./RunDialog").then((m) => ({ default: m.RunDialog })));
const NameConflictDialog = lazy(() => import("./NameConflictDialog").then((m) => ({ default: m.NameConflictDialog })));

export function usePanelDialogs(sessionId: string, active: boolean, disabled: boolean) {
  const [review, setReview] = useState<ReviewRequest | null>(null);
  const [sudoOpen, setSudoOpen] = useState(false);
  // La contraseña guardada (o la de la conexión) no sirvió para sudo: pedirla de nuevo.
  const storedSudo = useStoredSudoState(sessionId);
  useEffect(() => {
    if (storedSudo === "failed" && active && !disabled) setSudoOpen(true);
  }, [storedSudo, active, disabled]);
  const [logs, setLogs] = useState<LogsTarget | null>(null);
  const [inspectC, setInspectC] = useState<Container | null>(null);
  const [runForm, setRunForm] = useState<{ prefill?: Partial<RunForm>; owner?: string } | null>(null);
  /** Tarea que falló por un nombre de contenedor repetido (diálogo de arreglo). */
  const [conflict, setConflict] = useState<CtJob | null>(null);
  const askSudo = useCallback(() => setSudoOpen(true), []);

  return {
    review,
    setReview,
    sudoOpen,
    setSudoOpen,
    askSudo,
    logs,
    setLogs,
    inspectC,
    setInspectC,
    runForm,
    setRunForm,
    conflict,
    setConflict,
  };
}

type Dialogs = ReturnType<typeof usePanelDialogs>;

interface Props {
  dialogs: Dialogs;
  actions: EngineActions;
  runner: OwnerRunner;
  sessionId: string;
  profileId: string;
  user: string | null;
  disabled: boolean;
}

export function PanelDialogs({ dialogs: d, actions, runner, sessionId, profileId, user, disabled }: Props) {
  return (
    <>
      <Suspense fallback={null}>
        {d.logs && <LogsDialog target={d.logs} onClose={() => d.setLogs(null)} />}
        {d.inspectC && <InspectDialog container={d.inspectC} onClose={() => d.setInspectC(null)} />}
        {d.runForm && <RunDialog prefill={d.runForm.prefill} owner={d.runForm.owner} onClose={() => d.setRunForm(null)} />}
        {d.conflict && <NameConflictDialog job={d.conflict} onClose={() => d.setConflict(null)} />}
      </Suspense>
      {d.review && (
        <ReviewDialog
          req={d.review}
          sessionId={sessionId}
          exec={actions.run}
          elevationOf={actions.elevationOf}
          render={actions.render}
          fullScript={(cmds) => ownedFullScript(runner, cmds)}
          who={actions.who}
          disabled={disabled}
          onAskSudo={d.askSudo}
          onClose={() => d.setReview(null)}
          onFinished={actions.onReviewFinished}
        />
      )}
      {d.sudoOpen && <SudoDialog sessionId={sessionId} profileId={profileId} user={user} onClose={() => d.setSudoOpen(false)} />}
    </>
  );
}
