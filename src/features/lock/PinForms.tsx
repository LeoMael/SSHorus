// Formularios de la protección (PIN de 6 números o contraseña): crear (primera vez y Ajustes),
// cambiar (también de PIN a contraseña y al revés) y quitar.
import { useState, type FormEvent } from "react";
import { errorMessage, isApiError } from "../../api/core";
import { vault, type MoveReport, type PinKind } from "../../api/vault";
import { toast } from "../../stores/toasts";
import { ForgetWarning } from "./LockInfo";
import { applyVaultStatus, useLock } from "./lockStore";
import { emptyNewSecret, NewSecretFields, type NewSecretValue } from "./NewSecretFields";
import { PinField } from "./PinField";
import { checkNewPair, defaultNewKind, secretWords } from "./secretKind";

function movedText(r: MoveReport): string | undefined {
  if (r.moved === 0) return undefined;
  const n = r.moved === 1 ? "1 contraseña protegida" : `${r.moved} contraseñas protegidas`;
  return r.leftInKeyring > 0 ? `${n} (${r.leftInKeyring} copia(s) siguen en el llavero).` : `${n}.`;
}

/** Tipo actual de la bóveda (para pedir el PIN o la contraseña actuales). */
function useCurrentKind(): PinKind {
  return useLock((s) => s.status?.pinKind ?? "pin6");
}

/** Estado común: ocupado, error y una acción que los maneja. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>, onFail: (err: unknown) => string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(onFail(err));
      // La espera tras fallos la lleva el motor: se pide para mostrarla.
      vault.status().then(applyVaultStatus).catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function Actions({
  busy,
  canSubmit,
  label,
  busyLabel,
  danger,
  cancelLabel = "Cancelar",
  onCancel,
}: {
  busy: boolean;
  canSubmit: boolean;
  label: string;
  busyLabel?: string;
  danger?: boolean;
  cancelLabel?: string;
  onCancel?: () => void;
}) {
  return (
    <div className="lock-actions">
      {onCancel && (
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
      )}
      <button type="submit" className={danger ? "btn btn-danger" : "btn btn-primary"} disabled={busy || !canSubmit}>
        {busy ? <span className="spinner" /> : null} {busy && busyLabel ? busyLabel : label}
      </button>
    </div>
  );
}

/** Crear la protección (y mover las contraseñas del llavero a la bóveda). */
export function SetupPinForm({
  onDone,
  onCancel,
  cancelLabel,
  autoFocus,
}: {
  onDone?: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
  autoFocus?: boolean;
}) {
  const [next, setNext] = useState<NewSecretValue>(emptyNewSecret());
  const { busy, error, setError, run } = useAction();
  const words = secretWords(next.kind);

  const create = (s: NewSecretValue) => {
    const problem = checkNewPair(s.kind, s.value, s.again);
    if (problem) {
      setError(problem);
      setNext({ ...s, again: "" });
      return;
    }
    void run(async () => {
      const r = await vault.enable(s.value, s.kind);
      applyVaultStatus(await vault.status());
      toast.success(words.created, movedText(r));
      onDone?.();
    }, errorMessage);
  };

  return (
    <form
      className="lock-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        create(next);
      }}
    >
      <NewSecretFields
        state={next}
        onChange={(s) => {
          setNext(s);
          setError(null);
        }}
        onReady={create}
        autoFocus={autoFocus}
        disabled={busy}
      />
      <ForgetWarning />
      {error && <div className="lock-error">{error}</div>}
      <Actions
        busy={busy}
        canSubmit={!!next.value && !!next.again}
        label={`Crear ${words.noun}`}
        busyLabel="Creando…"
        cancelLabel={cancelLabel}
        onCancel={onCancel}
      />
    </form>
  );
}

/** Cambiar el PIN o la contraseña, o pasar de uno a otro (vuelve a cifrar la bóveda). */
export function ChangePinForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const kind = useCurrentKind();
  const current = secretWords(kind);
  const [old, setOld] = useState("");
  const [next, setNext] = useState<NewSecretValue>(() => emptyNewSecret(defaultNewKind(kind)));
  const { busy, error, setError, run } = useAction();

  const change = (s: NewSecretValue) => {
    const problem = !old ? `Escribe ${current.your} actual.` : checkNewPair(s.kind, s.value, s.again);
    if (problem) return setError(problem);
    void run(
      async () => {
        await vault.changePin(old, s.value, s.kind);
        applyVaultStatus(await vault.status());
        toast.success(s.kind === kind ? current.changed : `Ahora se usa ${secretWords(s.kind).noun}`);
        onDone();
      },
      (err) => {
        setOld("");
        return isApiError(err, "AuthFailed") ? current.wrong : errorMessage(err);
      },
    );
  };

  return (
    <form
      className="lock-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        change(next);
      }}
    >
      <div className="field">
        <span>{current.current}</span>
        <PinField kind={kind} value={old} onChange={setOld} label={current.current} autoFocus disabled={busy} />
      </div>
      <NewSecretFields state={next} onChange={setNext} onReady={change} disabled={busy} />
      {error && <div className="lock-error">{error}</div>}
      <Actions busy={busy} canSubmit={!!old && !!next.value && !!next.again} label="Cambiar" onCancel={onCancel} />
    </form>
  );
}

/** Quitar la protección: las contraseñas vuelven al llavero del sistema. */
export function DisablePinForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const kind = useCurrentKind();
  const words = secretWords(kind);
  const [pin, setPin] = useState("");
  const { busy, error, run } = useAction();

  const disable = (p: string) => {
    if (!p) return;
    void run(
      async () => {
        await vault.disable(p);
        applyVaultStatus(await vault.status());
        toast.success(words.removed, "Las contraseñas volvieron al llavero del sistema.");
        onDone();
      },
      (err) => {
        setPin("");
        return isApiError(err, "AuthFailed") ? words.wrong : errorMessage(err);
      },
    );
  };

  return (
    <form
      className="lock-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        disable(pin);
      }}
    >
      <p className="lock-text">Las contraseñas vuelven al llavero del sistema.</p>
      <div className="field">
        <span>{words.current}</span>
        <PinField kind={kind} value={pin} onChange={setPin} label={words.current} autoFocus disabled={busy} />
      </div>
      {error && <div className="lock-error">{error}</div>}
      <Actions busy={busy} canSubmit={!!pin} label={`Quitar ${words.noun}`} danger onCancel={onCancel} />
    </form>
  );
}
