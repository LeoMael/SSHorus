// A quién deja entrar sshd (AllowGroups/AllowUsers) en el asistente «Nuevo usuario con clave»: lo lee
// al abrir y avisa de lo que haría falta para que el usuario nuevo pueda entrar.
import { useEffect, useState } from "react";
import { errorMessage } from "../../../api/core";
import { parseSshdAccess, SSHD_ACCESS_SCRIPT, type AccessAdvice, type SshdAccess } from "../../../features/admin";
import { readElevated, type Elevation } from "../../../features/privileges";
import { splitSections } from "../../../lib/remote";

/** Mejor con sudo: «sshd -T» lee las llaves del servidor. */
export function useSshdAccess(sessionId: string, elevation: Elevation | null) {
  const [access, setAccess] = useState<SshdAccess | null>(null);
  const [accessNote, setAccessNote] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    readElevated(sessionId, SSHD_ACCESS_SCRIPT, elevation, 20)
      .then((r) => {
        if (!alive) return;
        const a = parseSshdAccess(splitSections(r.result.stdout));
        setAccess(a);
        if (a.source === "archivos") setAccessNote("Leído de /etc/ssh/sshd_config (sin «sshd -T»): puede no incluir bloques Match.");
      })
      .catch((e) => alive && setAccessNote(`No se pudo leer la configuración de sshd: ${errorMessage(e)}`));
    return () => {
      alive = false;
    };
  }, [sessionId, elevation]);
  return { access, accessNote };
}

export function KeyUserAccessNotes({
  access,
  accessNote,
  advice,
  allowGroup,
  addAllowGroup,
  setAddAllowGroup,
  name,
}: {
  access: SshdAccess | null;
  accessNote: string | null;
  advice: AccessAdvice | null;
  /** Grupo de AllowGroups que le falta al usuario nuevo. */
  allowGroup: string | null;
  addAllowGroup: boolean;
  setAddAllowGroup: (v: boolean) => void;
  name: string;
}) {
  return (
    <>
      {access && (access.allowGroups.length > 0 || access.allowUsers.length > 0) && (
        <div className="adm-note">
          sshd ({access.source}) solo deja entrar a
          {access.allowGroups.length > 0 && (
            <>
              {" "}
              los grupos <span className="mono">{access.allowGroups.join(", ")}</span>
            </>
          )}
          {access.allowGroups.length > 0 && access.allowUsers.length > 0 && " y"}
          {access.allowUsers.length > 0 && (
            <>
              {" "}
              los usuarios <span className="mono">{access.allowUsers.join(", ")}</span>
            </>
          )}
          .
        </div>
      )}
      {accessNote && <div className="faint">{accessNote}</div>}
      {allowGroup && (
        <label className="checkbox adm-check adm-mb">
          <input type="checkbox" checked={addAllowGroup} onChange={(e) => setAddAllowGroup(e.target.checked)} />
          Añadir al grupo <span className="mono">{allowGroup}</span> (AllowGroups de sshd)
        </label>
      )}
      {advice?.needAllowUsers && (
        <div className="adm-note adm-note-warn">
          AllowUsers no incluye a {name || "este usuario"}: al terminar podrás añadirlo (cambio aparte, con confirmación). Línea:{" "}
          <span className="mono">AllowUsers {name || "usuario"}</span>
        </div>
      )}
    </>
  );
}
