import { AlertTriangle, Info } from "lucide-react";
import type { ServerProfile } from "../../api/types";
import { serverAddress, type ServerMatches } from "../profiles/serverMatches";

/** Aviso de servidor repetido (mismo host, puerto y usuario) o del mismo host con otro usuario. */
export function MatchNote({
  matches,
  onOpen,
  addTo,
  onAdd,
}: {
  matches: ServerMatches;
  onOpen: (s: ServerProfile) => void;
  /** Proyecto al que se va a añadir el servidor nuevo (para ofrecer añadir el ya guardado). */
  addTo: { id: string; name: string; serverIds: string[] } | null;
  onAdd: (s: ServerProfile, projectId: string) => void;
}) {
  const { exact, sameHost } = matches;
  if (exact) {
    return (
      <div className="ssha-inline warn cd-match" role="status">
        <div className="ssha-inline-row">
          <AlertTriangle size={13} />
          <span>
            Ya tienes este servidor guardado como «<strong>{exact.name || exact.host}</strong>».
          </span>
          <button type="button" className="ssha-linkbtn" onClick={() => onOpen(exact)}>
            Abrir «{exact.name || exact.host}»
          </button>
          {addTo && !addTo.serverIds.includes(exact.id) && (
            <button type="button" className="ssha-linkbtn" onClick={() => onAdd(exact, addTo.id)}>
              Añadirlo a «{addTo.name}»
            </button>
          )}
        </div>
      </div>
    );
  }
  if (sameHost.length === 0) return null;
  const names = sameHost.slice(0, 3).map((s) => `«${s.name || s.host}» (${serverAddress(s)})`);
  return (
    <div className="ssha-inline cd-match" role="status">
      <div className="ssha-inline-row">
        <Info size={13} />
        <span>
          Este host ya está guardado: {names.join(", ")}
          {sameHost.length > 3 ? ` y ${sameHost.length - 3} más` : ""}.
        </span>
      </div>
    </div>
  );
}
