// Debajo de «Por usuario», al elegir una fila con contenedores: qué es ese número, en qué contenedores
// corre y si se puede cerrar. La acción segura es ir a Contenedores (parar o reiniciar el contenedor
// entero, con su confirmación); aquí no se para nada.
import { Box, ExternalLink } from "lucide-react";
import {
  containerName,
  containersOwnerKey,
  listNames,
  rowContainerOwner,
  type UserUsage,
} from "../../features/monitor";
import { useInfraNav } from "../../features/infra/store";
import { useOwnerNav } from "../../features/containers/ownerNav";

interface UserContainersNoteProps {
  sessionId: string;
  user: UserUsage;
  myUser: string | null;
  myUid: number | null;
}

export function UserContainersNote({ sessionId, user: u, myUser, myUid }: UserContainersNoteProps) {
  const target = rowContainerOwner(u);
  if (!target) return null;
  const names = u.inContainers.map(containerName);
  const owner = target.owner;
  const others = owner !== null && owner !== myUser && myUid !== 0 && target.engine !== "docker";

  const open = () => {
    useOwnerNav.getState().open(sessionId, containersOwnerKey(target, myUser, myUid === 0));
    useInfraNav.getState().open(sessionId, { kind: "containers", name: names[0] ?? "" });
  };

  return (
    <div className="mon-users-note" role="note">
      <Box size={14} className="mon-users-note-icon" aria-hidden="true" />
      <div className="mon-users-note-body">
        {u.sub && (
          <p>
            <strong>¿Qué es «{u.uid}»?</strong> Es el usuario {u.sub.innerUid} de dentro de{" "}
            {names.length === 1 ? "un contenedor" : "contenedores"} de <strong>{u.sub.owner}</strong>. Podman sin root reserva a
            cada usuario un rango de números (en <code>/etc/subuid</code>) para los usuarios de sus contenedores; por eso no
            tiene nombre en el servidor.
          </p>
        )}
        <p>
          {names.length ? (
            <>
              {u.sub ? "Sus procesos corren" : "Algunos de sus procesos corren"} en {names.length === 1 ? "el contenedor" : "los contenedores"}{" "}
              <strong>{listNames(names, 4)}</strong>
              {owner && <> de {owner}</>}.
            </>
          ) : (
            "Aún no se sabe en qué contenedor corren: se lee en la próxima muestra."
          )}
        </p>
        <p>
          <strong>¿Se puede cerrar?</strong> Sí, pero mejor desde Contenedores: allí se para o reinicia el contenedor
          entero. Terminar sus procesos uno a uno lo deja a medias (y puede volver a arrancar solo). Si es una base de datos,
          la aplicación que la usa deja de funcionar mientras esté parada.
        </p>
        <div className="mon-users-note-actions">
          <button className="btn btn-sm" onClick={open}>
            <ExternalLink size={12} /> Ver en Contenedores
          </button>
          {others && <span className="muted">Para ver los contenedores de {owner} hace falta sudo (o conectarte como {owner}).</span>}
        </div>
      </div>
    </div>
  );
}
