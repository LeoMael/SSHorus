// «Nuevo usuario con clave» con sudo: entra solo con su llave y tiene una contraseña que solo sirve para
// sudo (generada o escrita). Se muestra una vez al terminar y se guarda con el servidor en SSHorus
// (modo «Guardar» de la contraseña de sudo, el mismo que el editor de servidores).
import { useState } from "react";
import { Copy, Save } from "lucide-react";
import type { ServerProfile } from "../../api/types";
import { keyUserServer, pickSudoPassword, type SudoPassMode } from "../../features/admin";
import { useProfiles } from "../../stores/profiles";
import { toast } from "../../stores/toasts";
import { useUi } from "../../stores/ui";
import { copyText, PasswordField } from "./PasswordField";
import { Segmented } from "./Segmented";

export const KEY_USER_SUDO_NOTE = "Entra con su llave. La contraseña solo sirve para sudo y SSHorus la guarda.";

/** Estado de la contraseña de sudo del asistente. `choose()` la fija al revisar (la generada se reutiliza). */
export function useSudoPassword() {
  const [mode, setMode] = useState<SudoPassMode>("generate");
  const [typed, setTyped] = useState("");
  const [generated, setGenerated] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const choose = () => {
    const r = pickSudoPassword(mode, typed, generated);
    if (r.ok && mode === "generate") setGenerated(r.password);
    setChosen(r.ok ? r.password : null);
    return r;
  };
  return { mode, setMode, typed, setTyped, chosen, choose };
}

type SudoPassword = ReturnType<typeof useSudoPassword>;

/** Debajo de «Dar sudo»: generar una contraseña segura (por defecto) o escribirla. */
export function KeyUserSudoFields({ sudo, error }: { sudo: SudoPassword; error?: string }) {
  return (
    <div className="adm-note">
      <p className="adm-mb">{KEY_USER_SUDO_NOTE}</p>
      <Segmented
        label="Contraseña de sudo"
        value={sudo.mode}
        onChange={sudo.setMode}
        options={[
          { value: "generate", label: "Generar una segura" },
          { value: "type", label: "Escribirla" },
        ]}
      />
      {sudo.mode === "generate" ? (
        <div className="faint">Se genera al revisar y la verás una vez al terminar, con «Copiar».</div>
      ) : (
        <PasswordField label="Contraseña para sudo" value={sudo.typed} onChange={sudo.setTyped} />
      )}
      {error && (
        <div className="field-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/** Texto de la revisión del plan. */
export function KeyUserPlanNote({ name, sudo }: { name: string; sudo: boolean }) {
  if (!sudo)
    return (
      <p className="dialog-message">
        Se creará <strong>{name}</strong> sin contraseña: solo podrá entrar con su llave SSH. No se cambia
        PasswordAuthentication ni ninguna otra opción de sshd.
      </p>
    );
  return (
    <p className="dialog-message">
      Se creará <strong>{name}</strong> con una contraseña solo para sudo (va por stdin, no aparece en los comandos).
      Antes, sshd queda «solo llave» para él (<span className="mono">Match User {name}</span>): se comprueba con{" "}
      <span className="mono">sshd -t</span> y, si algo falla, se deshace y no se crea el usuario.
    </p>
  );
}

/** Al terminar: la contraseña, una sola vez, con «Copiar». */
export function SudoPasswordOnce({ name, password }: { name: string; password: string }) {
  const copy = () =>
    copyText(password).then(
      () => toast.success("Contraseña copiada"),
      (e) => toast.error("No se pudo copiar", e),
    );
  return (
    <div className="adm-note adm-note-warn">
      <span>Contraseña de sudo de {name} (solo se muestra ahora):</span>
      <div className="adm-pass">
        <input className="input mono" readOnly value={password} aria-label="Contraseña de sudo" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-sm" onClick={copy}>
          <Copy size={13} /> Copiar
        </button>
      </div>
      <span className="faint">{KEY_USER_SUDO_NOTE} Se guarda al pulsar «Guardar servidor en SSHorus».</span>
    </div>
  );
}

/**
 * «Guardar servidor en SSHorus…». Sin contraseña de sudo abre el editor con el servidor nuevo, como siempre.
 * Con ella lo guarda ya con la contraseña de sudo («Guardar», como el editor) y abre el editor para
 * retocarlo: así no se pierde aunque se cierre el editor sin guardar.
 */
export function SaveKeyUserServerButton({
  profile,
  name,
  keyPath,
  sudoPassword,
  onSaved,
}: {
  profile: ServerProfile | null;
  name: string;
  keyPath: string;
  sudoPassword: string | null;
  onSaved: () => void;
}) {
  const openServerEditor = useUi((s) => s.openServerEditor);
  const saveServer = useProfiles((s) => s.saveServer);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!profile) return;
    const { server, sudoSecret } = keyUserServer(profile, name, keyPath, sudoPassword);
    if (sudoSecret === undefined) {
      openServerEditor(server);
      return onSaved();
    }
    setBusy(true);
    const saved = await saveServer(server, undefined, sudoSecret);
    setBusy(false);
    if (!saved) return;
    toast.success(`Servidor «${saved.name}» guardado con su contraseña de sudo`);
    openServerEditor(saved);
    onSaved();
  };
  return (
    <button className="btn btn-primary" onClick={save} disabled={!profile || busy}>
      {busy ? <span className="spinner adm-spinner-btn" /> : <Save size={13} />} Guardar servidor en SSHorus…
    </button>
  );
}
