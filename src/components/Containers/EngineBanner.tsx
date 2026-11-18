// Aviso del panel de Contenedores cuando falta sudo, el motor no es accesible o el servicio Docker
// está parado, con sus botones (contraseña de sudo, grupo docker, iniciar Docker).
import { KeyRound, Play, ShieldAlert, Users } from "lucide-react";
import { dockerGroupCommand, type DetectResult, type EngineStatus } from "../../features/containers";
import type { ElevationState, PrivilegeInfo } from "../../features/privileges";
import type { ReviewRequest } from "./context";
import { bannerTitle } from "./panelLogic";
import type { OwnerScope } from "./useOwnerScope";

interface Props {
  scope: OwnerScope;
  status: EngineStatus;
  result: DetectResult;
  info: PrivilegeInfo | null;
  elev: ElevationState;
  askSudo: () => void;
  review: (req: ReviewRequest) => void;
  detect: () => Promise<void>;
}

export function EngineBanner({ scope, status, result, info, elev, askSudo, review, detect }: Props) {
  const { engine, needsSudo, elevation, dockerSelfSudo, isRoot } = scope;
  const canStartService = engine === "docker" && status.serviceDown;
  const sudoMissing = needsSudo && !elevation;
  if (!(sudoMissing || canStartService || (!status.accessible && !needsSudo))) return null;

  const canJoinDockerGroup = result.dockerGroupExists && !result.inDockerGroup;
  return (
    <div className="ct-banner" role="status">
      <ShieldAlert size={15} />
      <div className="ct-banner-text">
        <strong>
          {bannerTitle({
            dockerSelfSudo,
            problem: status.problem,
            all: scope.all,
            current: scope.current,
            waitingUsers: scope.waitingUsers,
          })}
        </strong>
        {sudoMissing && (
          <span>
            {elev.readOnlyReason && !elev.canAskSudo
              ? elev.readOnlyReason
              : "Introduce tu contraseña de sudo para usarlo desde aquí (se guarda solo en memoria)."}
            {engine === "docker" && canJoinDockerGroup && (
              <> También puedes añadir tu usuario al grupo «docker» (después hay que reconectar).</>
            )}
          </span>
        )}
        {status.rawError && <code className="ct-raw">{status.rawError}</code>}
      </div>
      {sudoMissing && elev.canAskSudo && (
        <button className="btn btn-sm btn-primary" onClick={askSudo}>
          <KeyRound size={13} /> Contraseña de sudo
        </button>
      )}
      {dockerSelfSudo && canJoinDockerGroup && (elev.elevation || elev.canAskSudo) && (
        <button
          className="btn btn-sm"
          onClick={() =>
            review({
              title: "Añadir mi usuario al grupo docker",
              message: (
                <>
                  Con esto podrás usar Docker sin sudo. El cambio se aplica en la <strong>próxima conexión</strong>. Ojo: estar en el
                  grupo «docker» equivale en la práctica a tener acceso de root.
                </>
              ),
              build: () => [{ bin: ["usermod"], args: ["-aG", "docker", info?.user ?? ""] }],
              elevationOverride: elev.elevation,
              success: "Usuario añadido al grupo docker\nReconecta para que tenga efecto",
            })
          }
          disabled={!info?.user}
          title={dockerGroupCommand(info?.user ?? null)}
        >
          <Users size={13} /> Añadir al grupo docker
        </button>
      )}
      {canStartService && (
        <button
          className="btn btn-sm"
          onClick={() =>
            review({
              title: "Iniciar el servicio Docker",
              message: "Arranca Docker y lo deja activado para que se inicie con el servidor.",
              build: () => [{ bin: ["systemctl"], args: ["enable", "--now", "docker"] }],
              elevationOverride: isRoot ? { kind: "none" } : elev.elevation,
              success: "Servicio Docker iniciado",
              onDone: () => void detect(),
            })
          }
        >
          <Play size={13} /> Iniciar Docker
        </button>
      )}
    </div>
  );
}
