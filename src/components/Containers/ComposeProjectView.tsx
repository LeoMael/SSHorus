// Vista detallada de un proyecto Compose: acciones (up/pull/build/restart/down/logs), editar el archivo,
// servicios y la última tarea del proyecto. Lo largo (levantar, actualizar) va en segundo plano.
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, FilePen, FolderOpen, Play, RotateCw, ScrollText, Square } from "lucide-react";
import { composeCmd, containerAction, runRaw, withOwner, type Cmd, type ComposeTool, type Container } from "../../features/containers";
import { useCtJobs } from "../../features/containers/jobs";
import { useExplorerNav } from "../../features/fileExplorer/nav";
import { shQuote } from "../../lib/remote";
import { toast } from "../../stores/toasts";
import { useCt } from "./context";
import { ComposeServices } from "./ComposeServices";
import { JobView } from "./JobView";

const ComposeEditDialog = lazy(() => import("./ComposeEditDialog").then((m) => ({ default: m.ComposeEditDialog })));

export interface ComposeProject {
  key: string;
  name: string;
  dir: string;
  /** Archivo compose (ruta absoluta o relativa a `dir`); "" = el que encuentre compose. */
  file: string;
  saved: boolean;
  containers: Container[];
  /** Usuario dueño (clave de `owner.ts`). */
  owner: string;
}

export function ComposeProjectView({
  p,
  tool,
  tools,
  setTool,
  onUsed,
}: {
  p: ComposeProject;
  tool: ComposeTool;
  tools: ComposeTool[];
  setTool: (t: ComposeTool) => void;
  onUsed: (dir: string, file: string) => void;
}) {
  const ct = useCt();
  const { run: runCt } = ct;
  const [services, setServices] = useState<string[] | null>(null);
  const [svcError, setSvcError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // La tarea más reciente de este proyecto (en marcha o terminada).
  const job = useCtJobs((s) => s.jobs.find((j) => j.key === p.key) ?? null);
  const busy = job?.status === "running";
  const canRun = !!p.dir;
  const fileLabel = !p.dir ? "carpeta desconocida" : p.file ? (p.file.startsWith("/") ? p.file : `${p.dir}/${p.file}`) : `${p.dir}/compose.yml`;
  const ids = p.containers.map((c) => c.name || c.id);
  const anyUp = p.containers.some((c) => c.state === "running" || c.state === "paused" || c.state === "restarting");
  const anyDown = p.containers.some((c) => c.state !== "running" && c.state !== "paused" && c.state !== "restarting");
  const asWho = ct.allOwners || p.owner !== "self" ? ` · ${ct.ownerLabel(p.owner)}` : "";

  const cmd = useCallback(
    (action: Parameters<typeof composeCmd>[3], opts: Parameters<typeof composeCmd>[4] = {}): Cmd => withOwner(composeCmd(tool, p.dir, p.file, action, opts), p.owner),
    [tool, p.dir, p.file, p.owner],
  );

  const loadServices = useCallback(async () => {
    if (!canRun) return;
    setSvcError(null);
    const r = await runCt([cmd("services")], 30);
    if (r.ok && r.result)
      setServices(
        r.result.stdout
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s && !/^>>>>|^\s*$/.test(s) && /^[a-zA-Z0-9._-]+$/.test(s)),
      );
    else {
      setServices(null);
      setSvcError(r.error ?? "No se pudo leer el archivo compose");
    }
  }, [cmd, canRun, runCt]);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  /** Tarea en segundo plano de este proyecto (salida en vivo abajo y en «Tareas»). */
  const launch = (title: string, cmds: Cmd[], success: string) =>
    ct.startJob({
      title,
      detail: `${p.name}${asWho}`,
      key: p.key,
      owner: p.owner,
      cmds: cmds.map((c) => ({ ...c, mergeStderr: true })),
      success,
      configCmd: cmd("config"),
      onFinished: (j) => {
        if (j.status === "done" && p.file) onUsed(p.dir, p.file);
        void ct.reload("containers");
        void loadServices();
      },
    });

  const review = (title: string, message: string, build: (o: Record<string, boolean>) => Cmd[], success: string, options?: { key: string; label: string }[], danger = false) =>
    ct.review({
      title: `${title} «${p.name}»`,
      message,
      options,
      build,
      danger,
      runLabel: title,
      timeoutSecs: 600,
      success,
      reload: ["containers"],
      onDone: () => void loadServices(),
    });

  /** El explorador usa tu usuario (SFTP, sin sudo): solo se abre si puedes entrar en la carpeta. */
  const openFolder = async () => {
    if (p.owner !== "self" && !ct.ownerIsRoot("self")) {
      const r = await runRaw(ct.sessionId, `[ -r ${shQuote(p.dir)} ] && [ -x ${shQuote(p.dir)} ] && echo si`, { kind: "none" }, 10);
      if (!r.result?.stdout.includes("si")) {
        toast.info(
          "El explorador no puede entrar en esa carpeta",
          `Es de ${ct.ownerLabel(p.owner)} y el explorador usa tu usuario, sin sudo. Usa «Editar compose» (con sudo) o conéctate como root para verla.`,
        );
        return;
      }
    }
    useExplorerNav.getState().open(ct.sessionId, p.dir);
  };

  return (
    <div className="ct-project">
      <div className="ct-project-head">
        <div>
          <h3>
            {p.name}
            {ct.allOwners && <span className="ct-tag">{ct.ownerLabel(p.owner)}</span>}
          </h3>
          <div className="faint mono ct-small">{fileLabel}</div>
        </div>
        <span className="ct-grow" />
        {tools.length > 1 && (
          <select className="select ct-select-sm" value={tool} onChange={(e) => setTool(e.target.value as ComposeTool)} aria-label="Herramienta de Compose">
            {tools.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>
      {!canRun && <div className="ct-warn">No se sabe en qué carpeta está este proyecto. Añádela a mano en la lista de la izquierda.</div>}
      <div className="ct-toolbar">
        <button className="btn btn-sm btn-primary" disabled={!canRun || busy} onClick={() => launch("Levantar", [cmd("up")], "Proyecto levantado")}>
          <Play size={13} /> Levantar
        </button>
        <button
          className="btn btn-sm"
          disabled={!canRun || busy}
          onClick={() =>
            ct.review({
              title: `Actualizar «${p.name}»`,
              message:
                "Descarga las versiones nuevas de las imágenes y vuelve a crear los contenedores que cambien (cortes de unos segundos). Sigue en segundo plano: puedes cerrar y seguirla en «Tareas».",
              options: [{ key: "build", label: "Volver a construir también las imágenes propias (build)" }],
              build: (o) => [cmd("pull"), cmd("up", { build: !!o.build })],
              runLabel: "Actualizar",
              success: "Proyecto actualizado",
              background: (cmds) => launch("Actualizar", cmds, "Proyecto actualizado"),
            })
          }
        >
          <ArrowDownToLine size={13} /> Actualizar
        </button>
        <button className="btn btn-sm" disabled={!canRun || busy} onClick={() => review("Reiniciar", "Reinicia todos los servicios del proyecto.", () => [cmd("restart")], "Proyecto reiniciado")}>
          <RotateCw size={13} /> Reiniciar
        </button>
        <button
          className="btn btn-sm ct-btn-danger"
          disabled={!canRun || busy}
          onClick={() =>
            review(
              "Bajar",
              "Para y elimina los contenedores y redes del proyecto. Los volúmenes con nombre se conservan salvo que marques la opción.",
              (o) => [cmd("down", { volumes: !!o.volumes })],
              "Proyecto bajado",
              [{ key: "volumes", label: "Borrar también los volúmenes del proyecto (-v): se pierden sus datos" }],
              true,
            )
          }
        >
          <Square size={13} /> Bajar
        </button>
        <button
          className="btn btn-sm"
          disabled={!canRun}
          onClick={() =>
            ct.openLogs({
              title: `Logs de «${p.name}»`,
              build: (tail) => cmd("logs", { tail }),
              follow: (tail) => {
                const c = cmd("logs", { tail });
                return { ...c, args: [...c.args, "-f"], mergeStderr: false };
              },
            })
          }
        >
          <ScrollText size={13} /> Logs
        </button>
        <button className="btn btn-sm" disabled={!canRun} onClick={() => setEditing(true)} title={`Abrir ${fileLabel} en el editor${asWho ? ` (como ${ct.ownerLabel(p.owner)})` : ""}`}>
          <FilePen size={13} /> Editar compose
        </button>
        <button className="btn btn-sm" disabled={!canRun || ct.disabled} onClick={() => void openFolder()} title="Ver la carpeta del proyecto en «Archivos»">
          <FolderOpen size={13} /> Abrir carpeta
        </button>
        {p.containers.length > 0 && (
          <>
            <span className="ct-sep" />
            <button
              className="btn btn-sm"
              disabled={!anyDown || busy}
              title="Arranca los contenedores ya creados (sin Compose)"
              onClick={() => launch("Iniciar contenedores", [withOwner(containerAction(ct.engine, "start", ids), p.owner)], "Contenedores iniciados")}
            >
              <Play size={13} /> Iniciar todos
            </button>
            <button
              className="btn btn-sm"
              disabled={!anyUp || busy}
              onClick={() => review("Parar", "Para los contenedores del proyecto sin borrarlos.", () => [withOwner(containerAction(ct.engine, "stop", ids), p.owner)], "Contenedores parados")}
            >
              <Square size={13} /> Parar todos
            </button>
          </>
        )}
      </div>

      <ComposeServices services={services} error={svcError} containers={p.containers} canRun={canRun} />

      {job && <JobView job={job} />}
      {editing && (
        <Suspense fallback={null}>
          <ComposeEditDialog p={p} onClose={() => setEditing(false)} onApply={() => launch("Aplicar cambios", [cmd("up")], "Cambios aplicados")} />
        </Suspense>
      )}
    </div>
  );
}
