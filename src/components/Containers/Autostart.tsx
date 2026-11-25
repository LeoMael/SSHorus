// Etiqueta «Activado» / «No activado» de arranque al reiniciar el servidor y revisión de comandos para
// activarlo o desactivarlo (uno o varios, cada uno como su dueño).
import { Info } from "lucide-react";
import {
  AUTOSTART_SERVICE,
  autostartPlan,
  autostartPolicy,
  composeGroups,
  stateTone,
  type AutostartInfo,
  type AutostartTarget,
  type Container,
} from "../../features/containers";
import { toast } from "../../stores/toasts";
import type { CtContextValue } from "./context";
import type { AutostartState } from "./useAutostart";
import { askComposeAutostart } from "./ComposeAutostart";
import "./Autostart.css";

const TEXT = { yes: "Activado", no: "No activado", unknown: "Sin datos" } as const;
const ARIA = {
  yes: "Activado: arranca solo al reiniciar el servidor",
  no: "No activado: no arranca solo al reiniciar el servidor",
  unknown: "Sin datos: no se pudo comprobar si arranca solo al reiniciar el servidor",
} as const;

/** `noData`: por qué no hay datos de este contenedor (se enseña como «Sin datos» con el motivo). */
export function AutostartBadge({ info, loading, noData }: { info: AutostartInfo | null; loading: boolean; noData?: string | null }) {
  if (!info) {
    if (loading) return <span className="ct-auto faint">…</span>;
    if (!noData) return null;
    const text = `Sin datos: ${noData}`;
    return (
      <span className="ct-auto ct-auto-unknown" title={text} aria-label={text}>
        <Info size={10} /> {TEXT.unknown}
      </span>
    );
  }
  // «Sin datos» dice qué no se pudo comprobar, no solo la etiqueta.
  const unknown = info.verdict === "unknown" ? info.why.filter((l) => /no se pudo/i.test(l)) : [];
  const aria = unknown.length ? `${ARIA.unknown}. ${unknown.join(" ")}` : ARIA[info.verdict];
  return (
    <span className={`ct-auto ct-auto-${info.verdict}`} title={info.why.join("\n")} aria-label={aria}>
      {unknown.length > 0 && <Info size={10} />} {TEXT[info.verdict]}
    </span>
  );
}

/** Texto del menú de la fila: activar si no arranca solo; si ya arranca, desactivar. */
export function autostartMenuLabel(info: AutostartInfo | null): { on: boolean; label: string } {
  return info?.verdict === "yes" ? { on: false, label: "Que no arranque solo…" } : { on: true, label: "Hacer que arranque solo…" };
}

function Notes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <ul className="ct-auto-notes">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

/** Abre la revisión (o avisa si no hay nada que hacer desde aquí). */
export function askAutostart(ct: CtContextValue, auto: AutostartState, on: boolean, cs: Container[]) {
  const targets: AutostartTarget[] = cs.flatMap((c) => {
    const info = auto.infoOf(c);
    if (!info || (on ? info.verdict === "yes" : info.verdict === "no" && (info.unit || info.policy === "no"))) return [];
    return [{ id: c.id, name: c.name, owner: c.owner ?? "", info }];
  });
  if (!targets.length) {
    toast.info(on ? "Ya arrancan solos" : "Ya no arrancan solos", cs.length === 1 ? cs[0].name : undefined);
    return;
  }
  // Proyectos de podman-compose cuyo servicio hay que preparar: tienen su propio camino.
  const compose = on ? composeGroups(targets, cs) : [];
  if (compose.length) {
    const g = compose[0];
    askComposeAutostart(ct, auto, g, targets.filter((t) => !g.targets.includes(t)));
    return;
  }
  const plan = autostartPlan(on, targets, { engine: ct.engine, version: ct.status.version, owner: auto.ownerOf, facts: auto.factsOf });
  if (!plan.cmds.length) {
    toast.info("No hay nada que cambiar desde aquí", plan.notes.join("\n"));
    return;
  }
  const policy = autostartPolicy(ct.engine, ct.status.version);
  const changedLinger = on && targets.some((t) => t.info.missing.includes("linger"));
  const onlyUnits = targets.every((t) => !!t.info.unit);
  const one = targets.length === 1;
  const what = one ? `«${targets[0].name}»` : `${targets.length} contenedores`;
  ct.review({
    title: on ? `Que ${what} arranque${one ? "" : "n"} solo${one ? "" : "s"}` : `Que ${what} no arranque${one ? "" : "n"} solo${one ? "" : "s"}`,
    message: (
      <>
        {on ? (
          onlyUnits ? (
            <>
              Se habilitará el servicio de systemd que gestiona {one ? "este contenedor" : "estos contenedores"} para que arranque
              automáticamente al reiniciar el servidor{changedLinger ? ", junto con linger para el usuario" : ""}.
            </>
          ) : (
            <>
              Se pone la política de reinicio <strong>{policy}</strong> (vuelve a arrancar si se cae y al reiniciar el servidor,
              salvo que lo pares tú). Si hace falta, también se habilita <strong>{AUTOSTART_SERVICE[ct.engine]}</strong>
              {ct.engine === "podman" ? ", que es quien arranca los contenedores al encender," : ""} y se activa linger para que los
              contenedores de un usuario arranquen sin que inicie sesión.
            </>
          )
        ) : onlyUnits ? (
          <>Se deshabilitará el servicio de systemd para que no arranque automáticamente al reiniciar el servidor.</>
        ) : (
          <>Se pone la política de reinicio «no»: no vuelve a arrancar si se cae ni al reiniciar el servidor.</>
        )}
        <Notes notes={plan.notes} />
      </>
    ),
    details: () => (
      <ul className="ct-list">
        {targets.slice(0, 12).map((t) => {
          const c = cs.find((x) => x.id === t.id && (x.owner ?? "") === t.owner);
          return (
            <li key={`${t.owner}/${t.id}`}>
              {c && <span className={`ct-dot ct-${stateTone(c.state)}`} />} <strong>{t.name}</strong>{" "}
              <span className="faint">{t.info.unit ? `servicio: ${t.info.unit}` : `política actual: ${t.info.policy}`}</span>
              {ct.allOwners && <span className="ct-tag">{ct.ownerLabel(t.owner)}</span>}
            </li>
          );
        })}
        {targets.length > 12 && <li className="faint">… y {targets.length - 12} más</li>}
      </ul>
    ),
    build: () => plan.cmds,
    runLabel: on ? "Activar" : "Desactivar",
    success: on ? (one ? `${what} arrancará solo` : `${what} arrancarán solos`) : one ? `${what} ya no arrancará solo` : `${what} ya no arrancarán solos`,
    onDone: () => {
      void auto.reload();
      if (changedLinger) ct.reloadUsers();
    },
  });
}
