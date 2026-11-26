// «Actualizar imagen»: qué se va a tocar (Compose, systemd, contenedores creados a mano o a mano del
// todo), qué se recrea y avisos del plan.
import type { Group, UpdatePlan } from "../../../features/vulnscan";

function GroupLine({ g }: { g: Group }) {
  switch (g.kind) {
    case "compose":
      return (
        <li>
          <strong>Compose</strong> «{g.project}» <span className="faint mono">({g.dir})</span>: se recrean {g.containers.join(", ")}
        </li>
      );
    case "systemd":
      return (
        <li>
          <strong>systemd</strong> «{g.unit}»{g.user ? " (de usuario)" : ""}: se reinicia y recrea {g.containers.join(", ")}
        </li>
      );
    case "run":
      return (
        <li>
          <strong>Creado a mano</strong>: {g.container.name}. Después de descargar se abre el formulario para revisarlo y confirmar.
        </li>
      );
    case "manual":
      return (
        <li className="vs-up-manual">
          <strong>A mano</strong>: {g.containers.join(", ")}. {g.reason}.
        </li>
      );
  }
}

export function ImageUpdatePlan({ plan }: { plan: UpdatePlan }) {
  return (
    <>
      {plan.groups.length > 0 && (
        <ul className="vs-up-groups">
          {plan.groups.map((g, i) => (
            <GroupLine key={i} g={g} />
          ))}
        </ul>
      )}
      {plan.recreated.length > 0 && (
        <p className="vs-up-recreate">
          Se recrean: <strong>{plan.recreated.join(", ")}</strong>
        </p>
      )}
      {plan.notes.map((n) => (
        <p key={n} className="vs-d-note">
          {n}
        </p>
      ))}
    </>
  );
}
