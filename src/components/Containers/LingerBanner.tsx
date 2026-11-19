// Aviso de Podman de otros usuarios sin linger: sus contenedores se paran al cerrar su sesión y no
// arrancan solos al reiniciar. Botón para `loginctl enable-linger` (se revisa el comando antes).
import { Clock } from "lucide-react";
import { displayPrefix, enableLingerCmd, usersWithoutLinger } from "../../features/containers";
import type { ReviewRequest } from "./context";
import type { OwnerScope } from "./useOwnerScope";

interface Props {
  scope: OwnerScope;
  review: (req: ReviewRequest) => void;
}

function names(list: string[]): string {
  return list.length === 1 ? `«${list[0]}»` : `${list.slice(0, -1).map((n) => `«${n}»`).join(", ")} y «${list[list.length - 1]}»`;
}

export function LingerBanner({ scope, review }: Props) {
  const users = usersWithoutLinger(scope.activeOwners, scope.engine);
  if (users.length === 0) return null;
  const one = users.length === 1;
  return (
    <div className="ct-banner" role="status">
      <Clock size={15} />
      <div className="ct-banner-text">
        <strong>{names(users.map((u) => u.name))} no {one ? "tiene" : "tienen"} linger</strong>
        <span>
          Sus contenedores se paran cuando {one ? "cierra" : "cierran"} sesión y no arrancan solos al reiniciar el servidor. Con
          «loginctl enable-linger» siguen encendidos.
        </span>
      </div>
      {users.map((u) => {
        const cmd = enableLingerCmd(u.name);
        return (
          <button
            key={u.name}
            className="btn btn-sm"
            title={displayPrefix(scope.elevPrefix, cmd)}
            onClick={() =>
              review({
                title: `Activar linger para ${u.name}`,
                message: (
                  <>
                    Los servicios de usuario de <strong>{u.name}</strong> (y sus contenedores) seguirán activos sin sesión abierta y
                    arrancarán con el servidor.
                  </>
                ),
                build: () => [cmd],
                elevationOverride: scope.otherEl,
                success: `Linger activado para ${u.name}`,
                onDone: () => scope.reloadUsersIfLoaded(),
              })
            }
          >
            {one ? "Activar linger" : `Linger: ${u.name}`}
          </button>
        );
      })}
    </div>
  );
}
