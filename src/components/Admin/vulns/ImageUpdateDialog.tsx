// «Actualizar imagen» (escáner → hallazgo de una imagen de Podman o Docker).
// 1. Lee en el momento (inspect, como el dueño) qué contenedores usan la imagen y cómo se crearon.
// 2. Muestra el plan y los comandos exactos; no se ejecuta nada sin confirmar.
// 3. Los pasos automáticos (descarga, Compose, systemd) van como tarea en segundo plano
//    (features/vulnscan/imageUpdateJob.ts): salida en vivo, «Cancelar», y se puede cerrar el diálogo.
// 4. Contenedores creados con `run`: formulario «Nuevo contenedor» relleno, en modo «reemplazar».
// 5. Vuelve a analizar la imagen y dice si siguen las vulnerabilidades.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { errorMessage } from "../../../api/core";
import type { Report, Target, UserCtx } from "../../../api/vulnscan";
import { displayCmds, emptyRunForm, failureMessage, validateRunForm, type RunForm } from "../../../features/containers";
import { renderCmd } from "../../../features/containers/shell";
import { wrapScript, ElevationError } from "../../../features/privileges";
import {
  elevationFor,
  imageUpdateData,
  ownerCtx,
  ownerIsRoot,
  ownerLabel,
  ownerOf,
  ownerScript,
  parseRead,
  planUpdate,
  readScript,
  replaceScript,
  rescanImage,
  rescanMessage,
  runAsOwner,
  runFormFrom,
  startImageUpdate,
  stepScript,
  UpdateCancel,
  UpdateCanceled,
  updatableTag,
  useVulnScan,
  watchImageUpdate,
  type Group,
  type ImageConfig,
  type RescanResult,
  type UpdatePlan,
} from "../../../features/vulnscan";
import { outputTail, runAsText } from "../../../features/vulnscan/imageUpdateText";
import { useJobs } from "../../../stores/jobs";
import { useSettings } from "../../../stores/settings";
import { toast } from "../../../stores/toasts";
import { JobPanel } from "../../Jobs/JobPanel";
import { AdmModal } from "../../ui/AdmModal";
import { useAdmin } from "../context";
import { ImageUpdatePlan } from "./ImageUpdatePlan";
import { ImageUpdateReplace } from "./ImageUpdateReplace";
import { ImageUpdateFooter } from "./ImageUpdateFooter";
import { ImageUpdateCommands, ImageUpdateOutcome, ImageUpdateReplaced } from "./ImageUpdateStatus";
import "../../Containers/Containers.css";
import "../../Containers/ContainersBars.css";
import "../../Containers/ContainersTable.css";
import "../../Containers/ContainersReview.css";
import "../../Containers/ContainersForm.css";
import "../../Containers/ContainersCleanup.css";

type Stage = "read" | "review" | "running" | "replace" | "rescan" | "done";
type RunGroup = Extract<Group, { kind: "run" }>;

export function ImageUpdateDialog({ report, target, onClose }: { report: Report; target: Target; onClose: () => void }) {
  const { sessionId, elevation, me, info, askSudo, disabled } = useAdmin();
  const settings = useSettings((s) => s.settings.vulnscan);
  const connectedAsRoot = info?.level === "root";
  const owner = useMemo(() => ownerOf(target, me, connectedAsRoot), [target, me, connectedAsRoot]);
  const engine = target.image?.engine ?? "podman";
  const tag = updatableTag(target) ?? "";
  const el = elevationFor(owner, elevation);
  const who = ownerLabel(owner, me);

  const cancel = useRef(new UpdateCancel());
  const [stage, setStage] = useState<Stage>("read");
  const [user, setUser] = useState<UserCtx | null>(null);
  const [plan, setPlan] = useState<UpdatePlan | null>(null);
  const [full, setFull] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needSudo, setNeedSudo] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobs((s) => (jobId ? (s.jobs.find((j) => j.id === jobId) ?? null) : null));
  const [runIdx, setRunIdx] = useState(0);
  const [imageCfg, setImageCfg] = useState<ImageConfig | null>(null);
  const [form, setForm] = useState<RunForm>(emptyRunForm);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<RescanResult | null>(null);
  const [replaced, setReplaced] = useState<string[]>([]);

  // El informe nuevo se pone en pantalla al cerrar: si se pusiera antes, el hallazgo (de la imagen
  // vieja) desaparece y con él este diálogo. Lo mismo con el de la tarea (watchImageUpdate), que va
  // antes: si luego se volvió a escanear aquí, ese informe es el más nuevo y se pone el último.
  useEffect(() => (jobId ? watchImageUpdate(jobId) : undefined), [jobId]);
  const newReport = useRef<Report | null>(null);
  useEffect(
    () => () => {
      if (newReport.current) useVulnScan.getState().setReport(sessionId, newReport.current);
    },
    [sessionId],
  );

  const runGroups = useMemo(() => (plan?.groups.filter((g) => g.kind === "run") ?? []) as RunGroup[], [plan]);
  const current = runGroups[runIdx] ?? null;

  /** Muestra un error (y el botón de sudo si hace falta). */
  const fail = (e: unknown) => {
    if (e instanceof UpdateCanceled) {
      setError("Cancelado.");
      return;
    }
    setError(e instanceof ElevationError ? e.message : errorMessage(e));
    setNeedSudo(e instanceof ElevationError && (e.failure === "need-password" || e.failure === "bad-password"));
  };

  // 1. Lectura (se repite si cambia la elevación, p. ej. tras escribir la contraseña de sudo).
  useEffect(() => {
    if (!el || disabled || stage !== "read") return;
    let alive = true;
    const c = new UpdateCancel();
    cancel.current = c;
    setError(null);
    setNeedSudo(false);
    (async () => {
      const u = await ownerCtx(sessionId, owner, el);
      const r = await runAsOwner(sessionId, engine, u, el, readScript(engine, target.image!.id), 60, c);
      const read = parseRead(r.stdout, target.image!.id);
      if (!read.complete) throw new Error(failureMessage(r));
      const p = planUpdate({ engine, tag, tags: target.image!.tags, read, ownerIsRoot: ownerIsRoot(owner, connectedAsRoot) });
      const script = await ownerScript(engine, u, p.steps.map(stepScript).join("\n"));
      if (!alive) return;
      setUser(u);
      setImageCfg(read.image);
      setPlan(p);
      setFull(wrapScript(script, el));
      setStage("review");
    })().catch((e) => alive && fail(e));
    return () => {
      alive = false;
      void c.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el?.kind, disabled, stage === "read"]);

  // 5. Volver a analizar (tras reemplazar los creados a mano, o a mano con «Volver a escanear»).
  const rescan = useCallback(async () => {
    if (!el) return;
    setStage("rescan");
    setError(null);
    setProgress("Volviendo a analizar la imagen…");
    const c = new UpdateCancel();
    cancel.current = c;
    try {
      const r = await rescanImage({ sessionId, report, target, tag, engine, user, el, useOsv: settings.useOsv, useTrivy: settings.useTrivy, cancel: c, onProgress: setProgress });
      newReport.current = r.report;
      setResult(r);
      if (r.remaining > 0) toast.info("Imagen actualizada", rescanMessage(r.remaining));
      else toast.success("Imagen actualizada", rescanMessage(0));
    } catch (e) {
      fail(e);
    } finally {
      setStage("done");
    }
  }, [el, sessionId, report, target, tag, engine, user, settings.useOsv, settings.useTrivy]);

  /** Prepara el formulario del contenedor «run» número `i` (o pasa a volver a analizar). */
  const openReplace = (i: number) => {
    const g = runGroups[i];
    setRunIdx(i);
    setError(null);
    setTouched(false);
    if (!g) {
      void rescan();
      return;
    }
    const { form: f, warnings: w } = runFormFrom(g.container, imageCfg, g.ref, engine);
    setForm(f);
    setWarnings(w);
    setStage("replace");
  };

  // 3. Pasos automáticos, en segundo plano.
  const start = () => {
    if (!plan || !el) return;
    setError(null);
    setNeedSudo(false);
    setStage("running");
    setJobId(
      startImageUpdate({
        sessionId,
        report,
        target,
        plan,
        tag,
        engine,
        user,
        el,
        who,
        useOsv: settings.useOsv,
        useTrivy: settings.useTrivy,
        actions: (d) => (d.needSudo ? [{ label: "Introducir contraseña de sudo", run: askSudo }] : []),
      }),
    );
  };

  // Al terminar la tarea (con el diálogo abierto): seguir con los creados a mano o enseñar el resultado.
  const jobStatus = job?.status;
  useEffect(() => {
    if (stage !== "running" || !job || jobStatus === "running") return;
    const d = imageUpdateData(job);
    if (jobStatus === "done" && d?.pendingRun.length) openReplace(0);
    else {
      if (d?.rescan) setResult(d.rescan);
      setStage("done");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobStatus]);

  // 4. Reemplazar un contenedor creado con `run`.
  const replace = async () => {
    if (!current || !el) return;
    setTouched(true);
    if (Object.keys(validateRunForm(form)).length) return;
    setBusy(true);
    setError(null);
    const c = new UpdateCancel();
    cancel.current = c;
    try {
      const r = await runAsOwner(sessionId, engine, user, el, replaceScript(engine, current.container.name, current.container.running, form), 900, c);
      if (r.exitCode !== 0 || r.timedOut) {
        setError(`${failureMessage(r)}\n\n${outputTail(r, 30)}`.trim());
        return;
      }
      setReplaced((x) => [...x, current.container.name]);
      toast.success("Contenedor reemplazado", current.container.name);
      openReplace(runIdx + 1);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const jobRunning = jobStatus === "running";
  const running = busy || stage === "rescan" || (stage === "read" && !!el && !error);
  const shownCmds = plan ? plan.steps.flatMap((s) => s.cmds) : [];
  const shown = owner.kind === "root" && el ? displayCmds(shownCmds, el) : shownCmds.map((c) => renderCmd(c));
  const howText = runAsText(owner, who);
  const errors = validateRunForm(form);

  return (
    <AdmModal
      title={stage === "replace" && current ? `Reemplazar contenedor «${current.container.name}»` : "Actualizar imagen"}
      onClose={() => !running && onClose()}
      width={stage === "replace" ? 760 : job ? 720 : 640}
    >
      <div className="modal-body vs-up">
        <div className="vs-up-head">
          <span className="mono">{tag}</span>
          <span className="faint">
            {engine} · de {who}
          </span>
        </div>

        {!el && (
          <div className="ct-warn">
            La imagen es de {who}: hace falta sudo para actualizarla.{" "}
            <button className="btn btn-sm" onClick={askSudo}>
              <KeyRound size={13} /> Introducir contraseña de sudo
            </button>
          </div>
        )}

        {stage === "read" && el && !error && (
          <div className="vs-up-progress">
            <Loader2 size={14} className="adm-spin" /> Leyendo los contenedores que usan la imagen…
          </div>
        )}

        {plan && (stage === "review" || stage === "running") && <ImageUpdatePlan plan={plan} />}

        {plan && stage === "review" && <ImageUpdateCommands howText={howText} shown={shown} full={full} />}

        {jobRunning && <p className="vs-d-note faint">Puedes cerrar esta ventana: sigue en segundo plano y verás un aviso al terminar.</p>}
        {job && stage !== "replace" && <JobPanel job={job} compact />}

        <ImageUpdateReplaced names={replaced} />

        {stage === "replace" && current && (
          <ImageUpdateReplace
            group={current}
            form={form}
            setForm={setForm}
            warnings={warnings}
            errors={errors}
            touched={touched}
            engine={engine}
            imageTags={target.image?.tags ?? []}
            lingerHint={engine === "podman" && owner.kind !== "root" && !connectedAsRoot}
            howText={howText}
            onSubmit={() => void replace()}
          />
        )}

        <ImageUpdateOutcome
          rescanning={stage === "rescan"}
          progress={progress}
          result={stage === "done" ? result : null}
          error={error}
          needSudo={needSudo}
          onAskSudo={askSudo}
        />
      </div>

      <ImageUpdateFooter
        running={running}
        stage={stage}
        replacing={!!current}
        canRun={!!el && !disabled}
        hasError={!!error}
        submitBlocked={touched && Object.keys(errors).length > 0}
        jobRunning={jobRunning}
        onCancelRun={() => void cancel.current.cancel()}
        onSkip={() => openReplace(runIdx + 1)}
        onReplace={() => void replace()}
        onStart={start}
        onRescan={() => void rescan()}
        onClose={onClose}
      />
    </AdmModal>
  );
}
