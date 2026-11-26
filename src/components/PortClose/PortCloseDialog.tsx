// «Cerrar puerto»: mira quién abre el puerto, explica en una o dos frases qué significa cerrarlo y ofrece
// solo las formas que funcionan (cortafuegos a prueba, parar el servicio o el programa, parar el contenedor
// o publicarlo solo en local), con los comandos exactos antes de confirmar. Nunca cierra el puerto de SSH.
// Lo abren Administración → Puertos y el mapa (nodo de un puerto).
import { lazy, Suspense, useState } from "react";
import { AlertTriangle, ExternalLink, Info, KeyRound, Play } from "lucide-react";
import { formatListen, type ListenPort, type PortsResult } from "../../features/admin";
import { useOwnerNav } from "../../features/containers/ownerNav";
import { useInfraNav } from "../../features/infra/store";
import { needsElevation, portTitle, startClose, type CloseOption, type CloseOptionId } from "../../features/portClose";
import { AdmModal } from "../ui/AdmModal";
import { ClosePreview } from "./ClosePreview";
import { usePortClose } from "./usePortClose";
import "./PortClose.css";

const SudoDialog = lazy(() => import("../Sudo/SudoDialog").then((m) => ({ default: m.SudoDialog })));

interface Props {
  port: ListenPort;
  /** Todos los puertos leídos (para saber cuáles son de SSH). */
  ports: PortsResult | null;
  sessionId: string;
  profileId: string;
  serverName: string;
  onClose: () => void;
}

/** Las que paran algo: el botón va en rojo. */
const DESTRUCTIVE: CloseOptionId[] = ["stop", "disable", "kill", "ctr-stop"];

function OptionRow({ o, checked, onPick }: { o: CloseOption; checked: boolean; onPick: () => void }) {
  return (
    <label className={`pc-opt${o.action ? "" : " off"}${checked ? " on" : ""}`}>
      <input type="radio" name="pc-option" checked={checked} disabled={!o.action} onChange={onPick} />
      <span className="pc-opt-body">
        <span className="pc-opt-title">
          {o.title}
          {o.recommended && <span className="pc-rec">Recomendado</span>}
        </span>
        <span className="pc-opt-text">{o.text}</span>
        {o.blocked && <span className="pc-why">{o.blocked}</span>}
      </span>
    </label>
  );
}

export function PortCloseDialog({ port, ports, sessionId, profileId, serverName, onClose }: Props) {
  const { plan, loading, error, elev, info } = usePortClose(sessionId, profileId, port, ports);
  const [choice, setChoice] = useState<CloseOptionId | null>(null);
  const [sudoOpen, setSudoOpen] = useState(false);
  const options = plan?.options ?? [];
  const pickedId = choice ?? options.find((o) => o.recommended)?.id ?? null;
  const picked = options.find((o) => o.id === pickedId && o.action) ?? null;
  const action = picked?.action ?? null;
  const missingSudo = !!action && needsElevation(action) && !elev.elevation;
  const anyBlockedBySudo = !elev.elevation && options.some((o) => o.blocked?.includes("sudo"));

  const apply = () => {
    if (!picked || !action) return;
    if (action.kind === "compose") {
      useOwnerNav.getState().open(sessionId, action.owner);
      useInfraNav.getState().open(sessionId, { kind: "containers", name: action.name });
      onClose();
      return;
    }
    if (action.kind === "hint") return;
    const title = `Cerrar ${portTitle(port)}: ${picked.title.toLowerCase()}`;
    if (startClose({ sessionId, profileId, serverName, elevation: elev.elevation, title, action })) onClose();
  };

  return (
    <>
      <AdmModal title={`Cerrar el puerto ${portTitle(port)}`} onClose={onClose} width={600}>
        <div className="modal-body pc-dialog" aria-busy={loading}>
          <div className="pc-addr faint">
            Escucha en <span className="mono">{formatListen(port)}</span>
          </div>
          {!plan && loading && (
            <div className="pc-loading" role="status">
              <span className="spinner" /> Mirando quién abre el puerto y cómo está el cortafuegos…
            </div>
          )}
          {error && (
            <div className="pc-error" role="alert">
              <AlertTriangle size={14} /> <span>{error}</span>
            </div>
          )}
          {plan && (
            <p className="pc-explain">
              <Info size={14} /> <span>{plan.explain}</span>
            </p>
          )}
          {options.length > 0 && (
            <div className="pc-opts" role="radiogroup" aria-label="Cómo cerrarlo">
              {options.map((o) => (
                <OptionRow key={o.id} o={o} checked={o.id === picked?.id} onPick={() => setChoice(o.id)} />
              ))}
            </div>
          )}
          {action && <ClosePreview action={action} elevation={elev.elevation} />}
          {(missingSudo || anyBlockedBySudo) && (
            <div className="pc-sudo">
              <span className="field-error">Hace falta sudo para {missingSudo ? "esto" : "ver y hacer más"}.</span>
              {elev.canAskSudo && (
                <button className="btn btn-sm" onClick={() => setSudoOpen(true)}>
                  <KeyRound size={13} /> Escribir la contraseña de sudo
                </button>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            {action?.kind === "hint" || options.length === 0 ? "Cerrar" : "Cancelar"}
          </button>
          {action?.kind === "compose" && (
            <button className="btn btn-primary" onClick={apply}>
              <ExternalLink size={13} /> Abrir en Contenedores
            </button>
          )}
          {(action?.kind === "firewall" || action?.kind === "run") && (
            <button className={DESTRUCTIVE.includes(picked!.id) ? "btn btn-danger" : "btn btn-primary"} onClick={apply} disabled={missingSudo || loading}>
              <Play size={13} /> Aplicar
            </button>
          )}
        </div>
      </AdmModal>
      {sudoOpen && (
        <Suspense fallback={null}>
          <SudoDialog sessionId={sessionId} profileId={profileId} user={info?.user ?? null} onClose={() => setSudoOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
