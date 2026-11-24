// Asistente «Crear llave SSH»: explica qué es, genera una ed25519 en ~/.ssh y ayuda a usarla
// en un servidor o en GitHub. Se abre desde Ajustes → Llaves SSH y desde el formulario del servidor.
import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { localkeys, type GeneratedKey } from "../../api/localkeys";
import { errorMessage } from "../../api/core";
import { useLocalKeys } from "./store";
import { freeKeyName, validateKeyName } from "./keys";
import { useTopEscape } from "./useTopEscape";
import { KeyUse } from "./KeyUse";
import "./SshKeys.css";

export interface CreatedKey extends GeneratedKey {
  name: string;
  comment: string;
}

export function CreateKeyWizard({
  onClose,
  onCreated,
  serverId,
}: {
  onClose: () => void;
  /** Al crearla (p. ej. el formulario del servidor rellena la ruta). */
  onCreated?: (k: CreatedKey) => void;
  /** Servidor que se propone en «Ponerla en un servidor». */
  serverId?: string;
}) {
  const [created, setCreated] = useState<CreatedKey | null>(null);
  useTopEscape(onClose);

  return (
    <Modal
      open
      title="Crear llave SSH"
      onClose={onClose}
      width="min(640px, 94vw)"
      footer={
        created ? (
          <button className="btn btn-primary" onClick={onClose} autoFocus>
            Listo
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn btn-primary" type="submit" form="sk-create-form">
              <KeyRound size={14} /> Crear llave
            </button>
          </>
        )
      }
    >
      {created ? (
        <KeyCreated k={created} serverId={serverId} />
      ) : (
        <KeyForm
          onCreated={(k) => {
            setCreated(k);
            void useLocalKeys.getState().reload();
            onCreated?.(k);
          }}
        />
      )}
    </Modal>
  );
}

// ───────── Paso 1: nombre, comentario y frase ─────────

function KeyForm({ onCreated }: { onCreated: (k: CreatedKey) => void }) {
  const data = useLocalKeys((s) => s.data);
  const taken = data?.keys.map((k) => k.name) ?? [];
  const [name, setName] = useState<string | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!useLocalKeys.getState().data) void useLocalKeys.getState().reload();
  }, []);

  // Hasta que el usuario escriba, se proponen un nombre libre y «usuario@equipo».
  const nameValue = name ?? freeKeyName(taken);
  const commentValue = comment ?? data?.defaultComment ?? "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const n = nameValue.trim();
    const err =
      validateKeyName(n) ??
      (taken.includes(n) ? `Ya tienes una llave llamada «${n}»: elige otro nombre` : null) ??
      (pass !== pass2 ? "Las dos frases no coinciden" : null);
    setError(err);
    if (err) return;
    setBusy(true);
    try {
      const k = await localkeys.generate(n, commentValue.trim(), pass);
      onCreated({ ...k, name: n, comment: commentValue.trim() });
    } catch (e2) {
      setError(errorMessage(e2));
      setBusy(false);
    }
  };

  return (
    <form id="sk-create-form" className="sk-form" onSubmit={(e) => void submit(e)}>
      <div className="sk-intro">
        <KeyRound size={16} aria-hidden />
        <p>
          Una llave SSH son dos archivos. La <strong>privada</strong> se queda en tu equipo y no se comparte nunca. La{" "}
          <strong>pública</strong> se pone en el servidor o en GitHub, y así entras sin escribir contraseña.
        </p>
      </div>
      <div className="sk-grid">
        <label className="field">
          <span>Nombre del archivo</span>
          <input
            className="input mono"
            value={nameValue}
            spellCheck={false}
            autoCapitalize="off"
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <small className="sk-hint">Se guarda en {data?.dir ?? "~/.ssh"}. Para GitHub, p. ej. id_ed25519_github.</small>
        </label>
        <label className="field">
          <span>Comentario</span>
          <input
            className="input mono"
            value={commentValue}
            spellCheck={false}
            autoCapitalize="off"
            placeholder="usuario@equipo"
            onChange={(e) => setComment(e.target.value)}
          />
          <small className="sk-hint">Para reconocerla luego.</small>
        </label>
        <label className="field">
          <span>Frase de paso (opcional)</span>
          <input className="input" type="password" value={pass} autoComplete="new-password" onChange={(e) => setPass(e.target.value)} />
          <small className="sk-hint">Protege la llave si alguien copia el archivo.</small>
        </label>
        {pass && (
          <label className="field">
            <span>Repite la frase</span>
            <input className="input" type="password" value={pass2} autoComplete="new-password" onChange={(e) => setPass2(e.target.value)} />
          </label>
        )}
      </div>
      <p className="sk-hint">Tipo ed25519: corta, rápida y segura. Nunca se sobrescribe una llave que ya exista.</p>
      {error && <div className="sk-result sk-result-bad">{error}</div>}
      {busy && <span className="spinner sk-spinner" />}
    </form>
  );
}

// ───────── Paso 2: la pública y dónde ponerla ─────────

function KeyCreated({ k, serverId }: { k: CreatedKey; serverId?: string }) {
  return (
    <div className="sk-form">
      <div className="sk-result sk-result-ok" role="status">
        <CheckCircle2 size={14} />
        <span>
          Llave creada. La privada está en <span className="mono">{k.privatePath}</span>: no la compartas.
        </span>
      </div>
      <KeyUse k={k} serverId={serverId} />
    </div>
  );
}
