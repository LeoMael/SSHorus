// «Que arranque solo» para un proyecto de podman-compose: prepara y habilita su servicio
// podman-compose@<proyecto> (plantilla, registro, linger) o, si no se puede o se prefiere, la política de
// reinicio + podman-restart.service. Se revisan los comandos antes, va en segundo plano y al terminar se
// vuelve a leer y se dice el estado nuevo.
import { Suspense, lazy, useState } from "react";
import { FilePen } from "lucide-react";
import {
  AUTOSTART_SERVICE,
  COMPOSE_STEP_TEXT,
  autostartPolicy,
  composeAutostartPlan,
  composeCmd,
  composeFor,
  withOwner,
  type AutostartTarget,
  type ComposeChoice,
  type ComposeGroup,
  type ComposePlan,
  type PlanCtx,
} from "../../features/containers";
import { toast } from "../../stores/toasts";
import type { CtContextValue } from "./context";
import { useCt } from "./context";
import type { AutostartState } from "./useAutostart";
import type { ComposeProject } from "./ComposeProjectView";

const ComposeEditDialog = lazy(() => import("./ComposeEditDialog").then((m) => ({ default: m.ComposeEditDialog })));

const CHOICE_TITLE: Record<ComposeChoice, (unit: string) => string> = {
  service: (unit) => `Servicio ${unit}`,
  restart: () => "Política de reinicio de cada contenedor",
};

/** El proyecto, tal como lo usa «Editar compose» (misma clave que en la pestaña Compose). */
function projectOf(g: ComposeGroup): ComposeProject {
  return { key: `${g.owner}|${g.dir ?? `project:${g.project}`}`, name: g.project, dir: g.dir ?? "", file: g.files[0] ?? "", saved: false, containers: g.containers, owner: g.owner };
}

/** «Editar compose…» para añadir `restart:` a los servicios (con copia de seguridad); luego `up -d`. */
function EditComposeButton({ g }: { g: ComposeGroup }) {
  const ct = useCt();
  const [open, setOpen] = useState(false);
  const p = projectOf(g);
  const tool = composeFor(ct.engine, ct.composeTools);
  const apply = () => {
    if (!tool) {
      toast.error("No hay Compose en el servidor", "Guarda el archivo y vuelve a levantar el proyecto desde la terminal.");
      return;
    }
    ct.startJob({
      title: "Aplicar cambios",
      detail: g.project,
      key: p.key,
      owner: g.owner,
      // Con todos sus archivos (`-f base.yml -f prod.yml`): solo con el primero, `up` recrearía sin lo demás.
      cmds: [{ ...withOwner(composeCmd(tool, p.dir, g.files.length ? g.files : p.file, "up", { project: g.project }), g.owner), mergeStderr: true }],
      success: "Cambios aplicados",
      onFinished: () => void ct.reload("containers"),
    });
  };
  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen(true)} disabled={!g.dir} title={g.dir ? undefined : "No se sabe en qué carpeta está el proyecto"}>
        <FilePen size={13} /> Editar compose…
      </button>
      {open && (
        <Suspense fallback={null}>
          <ComposeEditDialog p={p} onApply={apply} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

function ChoiceDetails({ g, plan, ct }: { g: ComposeGroup; plan: ComposePlan; ct: CtContextValue }) {
  const policy = autostartPolicy(ct.engine, ct.status.version);
  return (
    <div className="ct-auto-choice">
      <strong>{CHOICE_TITLE[plan.choice](g.unit)}</strong>
      {plan.choice === "service" ? (
        <>
          <div className="faint ct-small">
            Al encender, systemd levanta el proyecto entero con podman-compose. Hace falta podman-compose y linger para el usuario.
          </div>
          <ol className="ct-auto-notes">
            {plan.decision.steps.map((s) => (
              <li key={s}>{COMPOSE_STEP_TEXT[s]}</li>
            ))}
          </ol>
          {plan.decision.warnings.map((w) => (
            <div key={w} className="ct-warn-text">
              {w}
            </div>
          ))}
        </>
      ) : (
        <>
          <div className="faint ct-small">
            Cada contenedor lleva la política «{policy}» y, al encender, {AUTOSTART_SERVICE[ct.engine]} los arranca. Si vuelves a crear los
            contenedores con compose, se pierde: pon también <span className="mono">restart: {policy}</span> en cada servicio del archivo.
          </div>
          <div>
            <EditComposeButton g={g} />
          </div>
          {plan.notes.length > 0 && (
            <ul className="ct-auto-notes">
              {plan.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="faint ct-small">Contenedores: {g.targets.map((t) => t.name).join(", ")}</div>
    </div>
  );
}

/** Abre la revisión para el proyecto `g`. `rest`: los demás elegidos (se hacen aparte). */
export function askComposeAutostart(ct: CtContextValue, auto: AutostartState, g: ComposeGroup, rest: AutostartTarget[]) {
  const ctx: PlanCtx = { engine: ct.engine, version: ct.status.version, owner: auto.ownerOf, facts: auto.factsOf };
  const first = composeAutostartPlan(g, ctx);
  if (!first) {
    toast.info("Faltan datos para decidir", "Pulsa «Actualizar» en la lista de contenedores y vuelve a intentarlo.");
    return;
  }
  const { decision } = first;
  const other: ComposeChoice = decision.choice === "service" ? "restart" : "service";
  const planOf = (o: Record<string, boolean>) => (o.alt ? composeAutostartPlan(g, ctx, other) : null) ?? first;
  const who = ct.allOwners || g.owner !== "self" ? ` (${ct.ownerLabel(g.owner)})` : "";

  ct.review({
    title: `Que «${g.project}» arranque solo${who}`,
    message: (
      <>
        <div>{decision.why}</div>
        {rest.length > 0 && <div className="faint ct-small">Los demás elegidos ({rest.map((t) => `«${t.name}»`).join(", ")}) hazlos aparte.</div>}
      </>
    ),
    options: decision.serviceOk
      ? [{ key: "alt", label: other === "restart" ? "Usar en su lugar la política de reinicio" : `Usar en su lugar el servicio ${g.unit}` }]
      : undefined,
    details: (o) => <ChoiceDetails g={g} plan={planOf(o)} ct={ct} />,
    build: (o) => planOf(o).cmds,
    runLabel: "Activar",
    success: `«${g.project}» arrancará solo`,
    background: (cmds) => {
      const lingerChanged = cmds.some((c) => c.bin[0] === "loginctl");
      ct.startJob({
        title: "Arranque solo",
        detail: `${g.project}${who}`,
        key: projectOf(g).key,
        owner: g.owner,
        cmds: cmds.map((c) => ({ ...c, mergeStderr: true })),
        success: "Cambios hechos; comprobando el estado nuevo…",
        timeoutSecs: 900,
        onFinished: (j) => {
          if (lingerChanged) ct.reloadUsers();
          void ct.reload("containers");
          void auto.reload().then((all) => {
            const infos = g.targets.map((t) => auto.decideWith(all, t.id, t.owner));
            const pending = infos.find((i) => i?.verdict !== "yes");
            if (!pending) toast.success(`«${g.project}» arrancará solo al reiniciar el servidor`);
            else if (j.status === "done") toast.info(`«${g.project}» todavía no arranca solo`, pending?.why.join("\n"));
          });
        },
      });
    },
  });
}
