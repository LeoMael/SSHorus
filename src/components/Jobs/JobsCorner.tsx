// Esquina de abajo a la derecha: indicador de las tareas en segundo plano («2 tareas»), su ventanita con
// la lista (nombre, servidor, en qué va, tiempo, progreso, «Ver» y «Cancelar») y el aviso al terminar.
import { useEffect, useLayoutEffect, useRef } from "react";
import { ListChecks, Square, X } from "lucide-react";
import { cancelJob, countText, elapsedText, jobCounts, statusLine, type Job } from "../../features/jobs";
import { clearJobHistory, dropJobNotice, getJob, openJobCenter, setJobsPopover, useJobs } from "../../stores/jobs";
import { ToastCard } from "../ui/Toaster";
import { JobProgressBar, JobStatusIcon, useNow } from "./JobBits";
import "./Jobs.css";

const NOTICE_MS = { done: 8000, canceled: 8000, failed: 20000 } as const;
const NOTICE_TITLE = { done: "terminó", canceled: "se canceló", failed: "falló" } as const;

function Notice({ job }: { job: Job }) {
  const st = job.status === "running" ? "done" : job.status;
  useEffect(() => {
    const t = window.setTimeout(() => dropJobNotice(job.id), NOTICE_MS[st]);
    return () => window.clearTimeout(t);
  }, [job.id, st]);
  return (
    <ToastCard
      className="jb-notice"
      kind={st === "done" ? "success" : st === "failed" ? "error" : "info"}
      title={`${job.title} ${NOTICE_TITLE[st]}`}
      message={[job.server, statusLine(job)].filter(Boolean).join(" · ")}
      action={{ label: "Ver", onClick: () => openJobCenter({ jobId: job.id }) }}
      onClose={() => dropJobNotice(job.id)}
      closeLabel="Cerrar aviso"
    />
  );
}

function PopoverRow({ job, now }: { job: Job; now: number }) {
  const running = job.status === "running";
  return (
    <li className="jb-pop-row">
      <JobStatusIcon status={job.status} />
      <div className="jb-pop-main">
        <div className="jb-pop-top">
          <strong className="jb-ellipsis">{job.title}</strong>
          {job.server && <span className="faint jb-ellipsis">{job.server}</span>}
          <span className="jb-grow" />
          <span className="faint mono">{elapsedText(job, now)}</span>
        </div>
        <div className="jb-pop-line faint" title={statusLine(job)}>
          {statusLine(job)}
        </div>
        {running && job.progress && <JobProgressBar progress={job.progress} label={false} />}
      </div>
      <div className="jb-pop-btns">
        <button className="btn btn-sm" onClick={() => openJobCenter({ jobId: job.id })} aria-label={`Ver ${job.title}`}>
          Ver
        </button>
        {running && job.cancelLabel && (
          <button className="icon-btn" onClick={() => void cancelJob(job.id)} disabled={job.stopping} title={job.cancelLabel} aria-label={`${job.cancelLabel}: ${job.title}`}>
            <Square size={12} />
          </button>
        )}
      </div>
    </li>
  );
}

function Popover({ jobs, onClose }: { jobs: Job[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const c = jobCounts(jobs);
  const now = useNow(c.running > 0);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest(".jb-pop, .jb-pill")) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);
  return (
    <div
      ref={ref}
      id="jb-pop"
      className="jb-pop"
      role="dialog"
      aria-label="Tareas en segundo plano"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
          document.querySelector<HTMLElement>(".jb-pill")?.focus();
        }
      }}
    >
      <div className="jb-pop-head">
        <strong>Tareas en segundo plano</strong>
        <span className="jb-grow" />
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          <X size={14} />
        </button>
      </div>
      <ul className="jb-pop-list">
        {jobs.map((j) => (
          <PopoverRow key={j.id} job={j} now={now} />
        ))}
      </ul>
      <div className="jb-pop-foot">
        <span className="faint">Siguen aunque cierres el diálogo o cambies de pestaña.</span>
        <span className="jb-grow" />
        {c.finished > 0 && (
          <button className="btn btn-sm" onClick={clearJobHistory} title="Quita las terminadas (las que están en marcha siguen)">
            Vaciar
          </button>
        )}
        <button className="btn btn-sm" onClick={() => openJobCenter({ filter: null })}>
          Ver todo
        </button>
      </div>
    </div>
  );
}

const closePopover = () => setJobsPopover(false);

export function JobsCorner() {
  const jobs = useJobs((s) => s.jobs);
  const open = useJobs((s) => s.popover);
  const center = useJobs((s) => s.center);
  const noticeIds = useJobs((s) => s.notices);
  const ref = useRef<HTMLDivElement>(null);
  const c = jobCounts(jobs);
  const visible = jobs.length > 0 && !center;

  // Los avisos generales (toasts) se apilan encima de la esquina para no taparla.
  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el || !visible) {
      root.style.removeProperty("--jb-stack");
      return;
    }
    const sync = () => root.style.setProperty("--jb-stack", `${Math.round(window.innerHeight - el.getBoundingClientRect().top + 8)}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      root.style.removeProperty("--jb-stack");
    };
  }, [visible]);

  if (!visible) return null;
  const notices = noticeIds.map(getJob).filter((j): j is Job => !!j && j.status !== "running");
  const label = c.running > 0 ? countText(c.running) : `${c.finished} ${c.finished === 1 ? "terminada" : "terminadas"}`;
  return (
    <div ref={ref} className="jb-corner">
      <div className="jb-notices" role="status" aria-live="polite">
        {!open && notices.map((j) => <Notice key={j.id} job={j} />)}
      </div>
      {open && <Popover jobs={jobs} onClose={closePopover} />}
      <button
        className={c.running > 0 ? "jb-pill jb-pill-busy" : "jb-pill"}
        onClick={() => setJobsPopover(!open)}
        aria-expanded={open}
        aria-controls={open ? "jb-pop" : undefined}
        aria-label={`Tareas en segundo plano: ${c.running} en marcha${c.failed ? `, ${c.failed} con error` : ""}`}
        title="Tareas en segundo plano"
      >
        {c.running > 0 ? <span className="spinner jb-spinner" /> : <ListChecks size={13} />}
        {label}
        {c.failed > 0 && <span className="jb-pill-bad" aria-hidden="true" />}
      </button>
    </div>
  );
}
