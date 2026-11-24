// «Contenedores…» de un usuario: qué puede usar (Podman sin root, linger, Docker) y dar o quitar el permiso.
// Cada cambio se revisa antes (PlanReview). root, el usuario conectado y el grupo docker piden escribir el nombre.
import { useState, type ReactNode } from "react";
import {
  containerActions,
  freeSubidRange,
  grantDockerPlan,
  grantPodmanPlan,
  lingerPlan,
  rangeText,
  revokeDockerPlan,
  revokePodmanPlan,
  type AdminEnv,
  type ContainerAccessInfo,
  type ContainerAction,
  type Plan,
  type SubidRange,
  type UserContainers,
  type UserRow,
} from "../../features/admin";
import { AdmModal } from "../ui/AdmModal";
import { useAdmin } from "./context";
import { PlanReview } from "./PlanReview";
import { Segmented } from "../ui/Segmented";
import "./ContainerAccess.css";

interface Ctx {
  env: AdminEnv;
  user: UserRow;
  info: ContainerAccessInfo;
  access: UserContainers;
  linger: boolean;
}

const LINGER_NOTE = "Con linger, sus contenedores siguen encendidos cuando cierra la sesión y pueden arrancar solos al reiniciar el servidor.";

/** Cada acción: etiqueta, botón y su plan (o el motivo por el que no se puede). */
const ACTIONS: Record<ContainerAction, { label: string; run: string; plan: (c: Ctx) => Plan | string }> = {
  "podman-grant": {
    label: "Dar Podman",
    run: "Dar permiso",
    plan: (c) => {
      const range = freeSubidRange(c.info.subuid, c.info.subgid);
      if (!range) return "No queda un rango libre de 65536 identificadores en /etc/subuid y /etc/subgid.";
      return grantPodmanPlan(c.user, c.access, range, c.linger);
    },
  },
  "podman-revoke": { label: "Quitar Podman", run: "Quitar permiso", plan: (c) => revokePodmanPlan(c.user, c.access, c.linger) },
  "linger-on": { label: "Activar linger", run: "Activar linger", plan: (c) => lingerPlan(c.user.name, true) },
  "docker-grant": { label: "Dar Docker", run: "Añadir al grupo docker", plan: (c) => grantDockerPlan(c.env, c.user.name) },
  "docker-revoke": { label: "Quitar Docker", run: "Quitar del grupo docker", plan: (c) => revokeDockerPlan(c.env, c.user.name) },
};

const ranges = (rs: readonly SubidRange[]) => rs.map(rangeText).join(", ");

function Status({ info, access }: { info: ContainerAccessInfo; access: UserContainers }) {
  const podman = !info.podman
    ? "No está instalado"
    : access.podman === "yes"
      ? `Sí (subuid ${ranges(access.subuid)} · subgid ${ranges(access.subgid)})`
      : access.podman === "limited"
        ? "Limitado: sin rangos en /etc/subuid y /etc/subgid, muchas imágenes fallan"
        : "—";
  const docker = [
    access.dockerGroup ? "En el grupo docker (equivale a root)" : null,
    access.dockerRootless ? "Tiene Docker sin root encendido" : null,
  ].filter(Boolean);
  return (
    <dl className="cta-status">
      <dt>Podman</dt>
      <dd>{podman}</dd>
      {info.podman && access.linger !== null && (
        <>
          <dt>Linger</dt>
          <dd>
            {access.linger
              ? "Activado: sus contenedores siguen encendidos al salir y pueden arrancar solos al reiniciar el servidor"
              : "No: sus contenedores se apagan al salir y no arrancan solos al reiniciar el servidor"}
          </dd>
        </>
      )}
      {info.docker && (
        <>
          <dt>Docker</dt>
          <dd>
            {docker.length ? docker.join(" · ") : "No"}
            {access.dockerRootless === null && <span className="faint"> (sin sudo no se ve si usa Docker sin root)</span>}
          </dd>
        </>
      )}
    </dl>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="checkbox adm-check adm-mb">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/** Explicación y opciones de cada acción, en lenguaje simple. */
function ActionNotes({ action, c, setLinger, setAction, canPodman }: {
  action: ContainerAction;
  c: Ctx;
  setLinger: (v: boolean) => void;
  setAction: (a: ContainerAction) => void;
  canPodman: boolean;
}) {
  switch (action) {
    case "podman-grant": {
      const range = freeSubidRange(c.info.subuid, c.info.subgid);
      return (
        <>
          <p className="dialog-message">
            Se le da un rango propio de identificadores{range ? ` (${rangeText(range)})` : ""} en /etc/subuid y /etc/subgid. Con eso
            puede usar Podman sin root con casi todas las imágenes. Si ya usaba podman, sus contenedores encendidos se detienen para
            aplicar el cambio.
          </p>
          {c.access.linger === false && (
            <Check checked={c.linger} onChange={setLinger}>
              Mantener sus contenedores encendidos (linger)
            </Check>
          )}
        </>
      );
    }
    case "podman-revoke":
      return (
        <>
          <div className="adm-note adm-note-warn">
            <strong>Esto no le bloquea Podman del todo.</strong> Podrá seguir usándolo de forma muy limitada (un solo usuario dentro del
            contenedor; muchas imágenes fallarán). Sus contenedores e imágenes no se borran; los que estén encendidos se detienen. Para
            bloquearlo del todo habría que limitar el programa podman a un grupo (no se hace desde aquí).
          </div>
          {c.access.linger && (
            <Check checked={c.linger} onChange={setLinger}>
              Quitar también linger (sus servicios de usuario se apagarán al salir)
            </Check>
          )}
        </>
      );
    case "linger-on":
      return <p className="dialog-message">{LINGER_NOTE}</p>;
    case "docker-grant":
      return (
        <div className="adm-note cta-danger" role="alert">
          <strong>Estar en el grupo docker equivale a ser administrador (root) del servidor.</strong> Con un contenedor puede leer y
          cambiar cualquier archivo. Dáselo solo a quien le darías la contraseña de root. Tendrá efecto en su próxima sesión.
          {canPodman && (
            <div className="cta-alt">
              Para usar contenedores sin ese riesgo, mejor{" "}
              <button type="button" className="btn btn-sm" onClick={() => setAction("podman-grant")}>
                Dar Podman sin root
              </button>
            </div>
          )}
          {c.access.podman === "yes" && <div className="cta-alt">Ya puede usar Podman sin root, que es más seguro.</div>}
        </div>
      );
    case "docker-revoke":
      return (
        <p className="dialog-message">
          Dejará de poder usar Docker en su próxima sesión (si ahora tiene una abierta, la conserva hasta que salga). Sus contenedores no
          se borran.{c.access.dockerRootless ? " Su Docker sin root no depende de este grupo y sigue funcionando." : ""}
        </p>
      );
  }
}

function protectedNote(user: UserRow, me: string | null): string | null {
  if (user.uid === 0) return "Es root. Para seguir, escribe su nombre abajo.";
  if (me && user.name === me) return "Es el usuario con el que estás conectado. Para seguir, escribe su nombre abajo.";
  return null;
}

export function ContainerAccessDialog({ user, info, access, onClose }: {
  user: UserRow;
  info: ContainerAccessInfo;
  access: UserContainers;
  onClose: () => void;
}) {
  const { env, me } = useAdmin();
  const actions = containerActions({ info, user: access, uid: user.uid });
  const [action, setAction] = useState<ContainerAction | null>(actions[0] ?? null);
  const [linger, setLinger] = useState(false);
  const title = `Contenedores de ${user.name}`;
  const current = action && actions.includes(action) ? action : null;

  if (!env || !current) {
    return (
      <AdmModal title={title} onClose={onClose} width={560}>
        <div className="modal-body">
          <Status info={info} access={access} />
          <p className="dialog-message faint">
            {user.uid === 0 ? "root ya puede usar contenedores; no hace falta darle permiso." : "No hay nada que cambiar desde aquí."}
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose} autoFocus>
            Cerrar
          </button>
        </div>
      </AdmModal>
    );
  }

  const c: Ctx = { env, user, info, access, linger };
  const plan = ACTIONS[current].plan(c);
  const prot = protectedNote(user, me);
  const choose = (a: ContainerAction) => {
    setAction(a);
    setLinger(false);
  };
  const notes = (
    <>
      <ActionNotes action={current} c={c} setLinger={setLinger} setAction={choose} canPodman={actions.includes("podman-grant")} />
      {prot && <div className="adm-note adm-note-warn">{prot}</div>}
    </>
  );

  return (
    <AdmModal title={title} onClose={onClose} width={620}>
      {/* Fuera de PlanReview: al cambiar de acción la revisión empieza de cero, pero el selector conserva el foco. */}
      <div className="cta-head">
        <Status info={info} access={access} />
        {actions.length > 1 && (
          <Segmented label="Qué hacer" value={current} onChange={choose} options={actions.map((a) => ({ value: a, label: ACTIONS[a].label }))} />
        )}
      </div>
      {typeof plan === "string" ? (
        <>
          <div className="modal-body">
            {notes}
            <div className="adm-error" role="alert">
              {plan}
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </>
      ) : (
        <PlanReview
          key={current}
          plan={plan}
          confirmWord={prot || current === "docker-grant" ? user.name : undefined}
          onCancel={onClose}
          onDone={onClose}
          runLabel={ACTIONS[current].run}
        >
          {notes}
        </PlanReview>
      )}
    </AdmModal>
  );
}
