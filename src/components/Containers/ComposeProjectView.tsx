// Vista detallada de un proyecto Compose: acciones (up/pull/restart/down/logs), servicios y salida.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDownToLine, FileText, Play, RotateCw, ScrollText, Square, X } from "lucide-react";
import {
  composeCmd,
  containerAction,
  stateText,
  stateTone,
  withOwner,
  type Cmd,
  type ComposeTool,
  type Container,
} from "../../features/containers";
import { toast } from "../../stores/toasts";
import { useCt } from "./context";

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
  const [busy, setBusy] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [output, setOutput] = useState<{ title: string; text: string; ok: boolean } | null>(null);
  const started = useRef(0);
  const canRun = !!p.dir;
  const fileLabel = !p.dir ? "carpeta desconocida" : p.file ? (p.file.startsWith("/") ? p.file : `${p.dir}/${p.file}`) : `${p.dir}/compose.yml`;
  const ids = p.containers.map((c) => c.name || c.id);
  const anyUp = p.containers.some((c) => c.state === "running" || c.state === "paused" || c.state === "restarting");
  const anyDown = p.containers.some((c) => c.state !== "running" && c.state !== "paused" && c.state !== "restarting");

  const cmd = useCallback(
    (action: Parameters<typeof composeCmd>[3], opts: { volumes?: boolean; tail?: number } = {}): Cmd =>
      withOwner(composeCmd(tool, p.dir, p.file, action, opts), p.owner),
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

  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 500);
    return () => window.clearInterval(t);
  }, [busy]);

  const exec = async (label: string, cmds: Cmd[], success: string) => {
    setBusy(label);
    started.current = Date.now();
    setElapsed(0);
    setOutput(null);
    const r = await ct.run(
      cmds.map((c) => ({ ...c, mergeStderr: true })),
      600,
    );
    setBusy(null);
    const text = (r.result?.stdout ?? "")
      .split("\n")
      .filter((l) => !/Executing external compose provider|Please see podman-compose/.test(l))
      .join("\n")
      .trim();
    setOutput({ title: label, text: r.ok ? text : (r.error ?? text), ok: r.ok });
    if (r.ok) {
      toast.success(success, p.name);
      if (p.file) onUsed(p.dir, p.file);
    } else toast.error(`${label}: falló`, r.error?.split("\n")[0]);
    void ct.reload("containers");
    void loadServices();
  };

  const review = (
    title: string,
    message: string,
    build: (o: Record<string, boolean>) => Cmd[],
    success: string,
    options?: { key: string; label: string }[],
    danger = false,
  ) =>
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

  const svcRows = useMemo(() => {
    const names = new Set([...(services ?? []), ...p.containers.map((c) => c.composeService ?? "").filter(Boolean)]);
    const rows = [...names].sort().map((s) => ({ name: s, containers: p.containers.filter((c) => c.composeService === s) }));
    for (const c of p.containers) if (!c.composeService) rows.push({ name: c.name, containers: [c] });
    return rows;
  }, [services, p.containers]);

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
        <button className="btn btn-sm btn-primary" disabled={!canRun || !!busy} onClick={() => void exec("Levantar", [cmd("up")], "Proyecto levantado")}>
          {busy === "Levantar" ? <span className="spinner ct-spinner-sm" /> : <Play size={13} />} Levantar
        </button>
        <button
          className="btn btn-sm"
          disabled={!canRun || !!busy}
          onClick={() =>
            review(
              "Actualizar",
              "Descarga las versiones nuevas de las imágenes y vuelve a crear los contenedores que cambien (cortes de unos segundos).",
              () => [cmd("pull"), cmd("up")],
              "Proyecto actualizado",
            )
          }
        >
          <ArrowDownToLine size={13} /> Actualizar
        </button>
        <button
          className="btn btn-sm"
          disabled={!canRun || !!busy}
          onClick={() => review("Reiniciar", "Reinicia todos los servicios del proyecto.", () => [cmd("restart")], "Proyecto reiniciado")}
        >
          <RotateCw size={13} /> Reiniciar
        </button>
        <button
          className="btn btn-sm ct-btn-danger"
          disabled={!canRun || !!busy}
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
        <button
          className="btn btn-sm"
          disabled={!canRun || !!busy}
          onClick={async () => {
            const r = await ct.run([{ bin: ["cat"], args: ["--", p.file || "compose.yml"], cwd: p.dir, owner: p.owner }], 20);
            setOutput({ title: fileLabel, text: r.ok ? (r.result?.stdout ?? "") : (r.error ?? ""), ok: r.ok });
          }}
        >
          <FileText size={13} /> Ver archivo
        </button>
        {p.containers.length > 0 && (
          <>
            <span className="ct-sep" />
            <button
              className="btn btn-sm"
              disabled={!anyDown || !!busy}
              title="Arranca los contenedores ya creados (sin Compose)"
              onClick={() => void exec("Iniciar contenedores", [withOwner(containerAction(ct.engine, "start", ids), p.owner)], "Contenedores iniciados")}
            >
              <Play size={13} /> Iniciar todos
            </button>
            <button
              className="btn btn-sm"
              disabled={!anyUp || !!busy}
              onClick={() =>
                review("Parar", "Para los contenedores del proyecto sin borrarlos.", () => [withOwner(containerAction(ct.engine, "stop", ids), p.owner)], "Contenedores parados")
              }
            >
              <Square size={13} /> Parar todos
            </button>
          </>
        )}
        {busy && (
          <span className="faint ct-small">
            {busy}… {elapsed} s
          </span>
        )}
      </div>

      <h4 className="section-label">Servicios</h4>
      {svcError && (
        <div className="ct-error ct-error-inline" role="alert">
          <AlertTriangle size={14} />
          <pre>{svcError}</pre>
        </div>
      )}
      <table className="ct-table ct-table-auto">
        <thead>
          <tr>
            <th>Servicio</th>
            <th>Contenedor</th>
            <th>Estado</th>
            <th>Imagen</th>
          </tr>
        </thead>
        <tbody>
          {svcRows.map((s) =>
            s.containers.length === 0 ? (
              <tr key={s.name}>
                <td className="ct-strong">{s.name}</td>
                <td className="faint">—</td>
                <td className="faint">
                  <span className="ct-cell-flex">
                    <span className="ct-dot ct-off" /> Sin crear
                  </span>
                </td>
                <td />
              </tr>
            ) : (
              s.containers.map((c) => (
                <tr key={c.id}>
                  <td className="ct-strong">{s.name}</td>
                  <td className="mono">{c.name}</td>
                  <td title={c.status}>
                    <span className="ct-cell-flex">
                      <span className={`ct-dot ct-${stateTone(c.state)}`} /> {stateText(c)}
                    </span>
                  </td>
                  <td className="mono faint ct-ellipsis">{c.image}</td>
                </tr>
              ))
            ),
          )}
          {svcRows.length === 0 && (
            <tr>
              <td colSpan={4} className="ct-norows">
                {services === null && !svcError && canRun ? "Leyendo servicios…" : "Sin servicios"}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {output && (
        <div className="ct-outbox">
          <div className="ct-outbox-head">
            <span className={output.ok ? "" : "ct-bad-text"}>{output.title}</span>
            <button className="icon-btn" onClick={() => setOutput(null)} aria-label="Cerrar salida">
              <X size={13} />
            </button>
          </div>
          <pre className="ct-output">{output.text || "(sin salida)"}</pre>
        </div>
      )}
    </div>
  );
}
