// Último paso de «Nuevo usuario con clave»: prueba sola la conexión con la llave nueva, avisa si sshd
// no le dejará entrar (y ofrece añadirlo a AllowUsers) y permite guardar el servidor en SSHorus.
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, PlugZap, ShieldAlert, XCircle } from "lucide-react";
import { ssh } from "../../../api/ssh";
import type { ServerProfile } from "../../../api/types";
import { allowUsersPlan, type AccessAdvice, type SshdAccess } from "../../../features/admin";
import { describeTestOk, testServerConnection } from "../../../features/connect/serverTest";
import { AdmModal } from "../../ui/AdmModal";
import { PlanModal } from "../PlanReview";
import { SaveKeyUserServerButton, SudoPasswordOnce } from "./KeyUserSudo";

type TestState = { status: "idle" | "running" } | { status: "ok" | "error"; message: string };

export function KeyUserDone({
  title,
  name,
  profile,
  initialKeyPath,
  passphrase,
  sudoPassword,
  access,
  advice,
  onClose,
}: {
  title: string;
  name: string;
  /** El servidor guardado de esta pestaña (sin él no se puede probar). */
  profile: ServerProfile | null;
  /** Privada de la llave elegida, si se sabe dónde está. */
  initialKeyPath: string;
  /** Frase de la llave generada en el asistente. */
  passphrase: string | undefined;
  sudoPassword: string | null;
  access: SshdAccess | null;
  advice: AccessAdvice | null;
  onClose: () => void;
}) {
  const [keyPath, setKeyPath] = useState(initialKeyPath);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [allowUsersOpen, setAllowUsersOpen] = useState(false);
  const [allowUsersDone, setAllowUsersDone] = useState(false);
  const testId = useRef<string | null>(null);
  const closed = useRef(false);

  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      if (testId.current) void ssh.cancelTest(testId.current).catch(() => {});
    };
  }, []);

  const runTest = async () => {
    if (!profile) return;
    setTest({ status: "running" });
    const draft: ServerProfile = { ...profile, id: "", username: name, auth: keyPath ? "key" : "agent", keyPath: keyPath || null };
    const out = await testServerConnection(draft, { passphrase }, (id) => (testId.current = id), () => closed.current);
    testId.current = null;
    if (closed.current) return;
    if (out.status === "ok") setTest({ status: "ok", message: describeTestOk(out.result, draft.auth) });
    else if (out.status === "error") setTest({ status: "error", message: out.message });
    else setTest({ status: "idle" });
  };

  // Al llegar aquí se prueba sola la conexión con la llave (si se sabe dónde está la privada o hay agente).
  useEffect(() => {
    if (profile) void runTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdmModal title={title} onClose={onClose} width={620}>
      <div className="modal-body">
        <p className="dialog-message">
          <CheckCircle2 size={14} className="adm-ok" /> Usuario <strong>{name}</strong> creado con su llave en
          ~/.ssh/authorized_keys.
        </p>
        {sudoPassword && <SudoPasswordOnce name={name} password={sudoPassword} />}
        {advice?.needAllowUsers && !allowUsersDone && (
          <div className="adm-note adm-note-warn">
            <ShieldAlert size={13} /> sshd solo deja entrar a los usuarios de <span className="mono">AllowUsers</span> (
            {access?.allowUsers.join(", ")}): <strong>{name}</strong> no podrá entrar hasta añadirlo.{" "}
            <button className="btn btn-sm" onClick={() => setAllowUsersOpen(true)}>
              Añadir a AllowUsers…
            </button>
          </div>
        )}
        {advice?.denied && <div className="adm-note adm-note-warn">{advice.denied}</div>}
        <label className="field">
          <span>Llave privada para probar (en este equipo; vacío = agente SSH)</span>
          <input
            className="input mono"
            value={keyPath}
            spellCheck={false}
            onChange={(e) => setKeyPath(e.target.value)}
            placeholder="~/.ssh/id_ed25519"
          />
        </label>
        {!profile && <div className="adm-note">No se encontró el servidor guardado de esta pestaña: no se puede probar.</div>}
        {test.status === "running" && (
          <div className="adm-loading">
            <span className="spinner" /> Probando {name}@{profile?.host}…
          </div>
        )}
        {(test.status === "ok" || test.status === "error") && (
          <div className={test.status === "ok" ? "adm-note" : "adm-error"} role="status">
            {test.status === "ok" ? <CheckCircle2 size={14} className="adm-ok" /> : <XCircle size={14} />}
            <span> {test.message}</span>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn adm-footer-left" onClick={runTest} disabled={!profile || test.status === "running"}>
          <PlugZap size={13} /> Probar conexión
        </button>
        <button className="btn" onClick={onClose}>
          Cerrar
        </button>
        <SaveKeyUserServerButton profile={profile} name={name} keyPath={keyPath} sudoPassword={sudoPassword} onSaved={onClose} />
      </div>
      {allowUsersOpen && (
        <PlanModal
          title={`Añadir ${name} a AllowUsers`}
          plan={allowUsersPlan(name)}
          onCancel={() => setAllowUsersOpen(false)}
          onDone={() => {
            setAllowUsersOpen(false);
            setAllowUsersDone(true);
            setTest({ status: "idle" });
          }}
          runLabel="Cambiar sshd"
        >
          <p className="dialog-message">
            Cambio global de sshd: se crea un archivo en /etc/ssh/sshd_config.d con «AllowUsers {name}», se comprueba
            con <span className="mono">sshd -t</span> (si falla se deshace) y se recarga sshd. Las sesiones abiertas no
            se cortan.
          </p>
        </PlanModal>
      )}
    </AdmModal>
  );
}
