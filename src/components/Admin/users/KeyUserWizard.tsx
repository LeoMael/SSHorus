// «Nuevo usuario con clave»: usuario que solo entra con su llave SSH.
// Formulario → revisión del plan (comandos exactos) → resultado (KeyUserDone.tsx): prueba de conexión con
// esa llave y opción de guardar el servidor en SSHorus. Con «Dar sudo», contraseña solo para sudo y sshd
// «solo llave» para él (KeyUserSudo.tsx). AllowUsers, si hace falta, se pide aparte.
import { useMemo, useState } from "react";
import { accessAdvice, createKeyUserPlan, type Plan } from "../../../features/admin";
import { defaultShell, parseGroupList, validateKeyUserForm } from "../../../features/admin/keyUserForm";
import { useProfiles } from "../../../stores/profiles";
import { useAdmin } from "../context";
import { AdmModal } from "../../ui/AdmModal";
import { KeyUserPlanNote, KeyUserSudoFields, useSudoPassword } from "./KeyUserSudo";
import { PlanReview } from "../PlanReview";
import { KeyUserAccessNotes, useSshdAccess } from "./KeyUserAccess";
import { KeyUserDone } from "./KeyUserDone";
import { KeyUserKeySource } from "./KeyUserKeySource";
import { useKeySource } from "./useKeySource";

type Step = "form" | "review" | "done";

export function KeyUserWizard({ onClose, onCreated }: { onClose: () => void; onCreated?: (name: string) => void }) {
  const { env, read, users, sessionId, profileId, elevation, serverName } = useAdmin();
  const profile = useProfiles((s) => s.servers.find((x) => x.id === profileId) ?? null);

  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const key = useKeySource(name, profile?.host ?? serverName, setErrors);
  const { access, accessNote } = useSshdAccess(sessionId, elevation);
  const [addAllowGroup, setAddAllowGroup] = useState(true);
  const [extraGroups, setExtraGroups] = useState("");
  const [admin, setAdmin] = useState(false);
  const [linger, setLinger] = useState(false);
  const [allowTunnels, setAllowTunnels] = useState(false);
  const [tunnelsTouched, setTunnelsTouched] = useState(false);
  const sudo = useSudoPassword();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [keyPath, setKeyPath] = useState("");

  const shell = useMemo(() => defaultShell(read?.shells ?? []), [read]);
  const groupList = parseGroupList(extraGroups);
  const advice = access ? accessAdvice(access, name || "-", [name, ...groupList, ...(admin && env ? [env.adminGroup] : [])]) : null;
  const allowGroup = access ? accessAdvice(access, name || "-", [name]).needGroup : null;

  const review = () => {
    if (!env) return;
    const k = key.keyLine();
    const sp = admin ? sudo.choose() : null;
    const { errors: errs, publicKey } = validateKeyUserForm({
      name,
      users: users.map((u) => u.name),
      groups: (read?.groups ?? []).map((g) => g.name),
      toolset: env.toolset,
      key: k,
      extraGroups: groupList,
      sudo: sp,
    });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const groups = [...groupList, ...(allowGroup && addAllowGroup ? [allowGroup] : [])];
    const sudoPassword = sp?.ok ? sp.password : undefined;
    setPlan(createKeyUserPlan(env, { name, publicKey, shell, groups, admin, linger, allowTunnels, sudoPassword }));
    if (typeof k !== "string") setKeyPath(k.privatePath);
    setStep("review");
  };

  const sudoPassword = admin ? sudo.chosen : null;

  const title = "Nuevo usuario con clave SSH";
  if (!env) return null;

  if (step === "review" && plan) {
    return (
      <AdmModal title={title} onClose={onClose} width={660}>
        <PlanReview
          plan={plan}
          onBack={() => setStep("form")}
          onCancel={onClose}
          onDone={() => {
            onCreated?.(name);
            setStep("done");
          }}
          runLabel="Crear usuario"
        >
          <KeyUserPlanNote name={name} sudo={!!sudoPassword} />
        </PlanReview>
      </AdmModal>
    );
  }

  if (step === "done") {
    return (
      <KeyUserDone
        title={title}
        name={name}
        profile={profile}
        initialKeyPath={keyPath}
        passphrase={key.source === "generate" ? key.generated?.passphrase : undefined}
        sudoPassword={sudoPassword}
        access={access}
        advice={advice}
        onClose={onClose}
      />
    );
  }

  const err = (k: string) =>
    errors[k] ? (
      <div className="field-error" role="alert">
        {errors[k]}
      </div>
    ) : null;

  return (
    <AdmModal title={title} onClose={onClose} width={660}>
      <form
        className="adm-form"
        onSubmit={(e) => {
          e.preventDefault();
          review();
        }}
      >
        <div className="modal-body">
          <label className="field">
            <span>Nombre de usuario</span>
            <input
              className="input mono"
              value={name}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              maxLength={32}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              placeholder="p. ej. deploy"
              aria-invalid={!!errors.name}
            />
            {err("name")}
          </label>

          <KeyUserKeySource k={key} />
          {err("gen")}
          {err("key")}

          <KeyUserAccessNotes
            access={access}
            accessNote={accessNote}
            advice={advice}
            allowGroup={allowGroup}
            addAllowGroup={addAllowGroup}
            setAddAllowGroup={setAddAllowGroup}
            name={name}
          />
          <label className="field">
            <span>Otros grupos (opcional, separados por comas)</span>
            <input
              className="input mono"
              value={extraGroups}
              spellCheck={false}
              onChange={(e) => setExtraGroups(e.target.value)}
              placeholder="p. ej. docker"
            />
            {err("groups")}
          </label>
          <label className="checkbox adm-check adm-mb">
            <input
              type="checkbox"
              checked={admin}
              onChange={(e) => {
                const next = e.target.checked;
                setAdmin(next);
                if (!tunnelsTouched) setAllowTunnels(next);
              }}
            />
            Dar sudo (grupo <span className="mono">{env.adminGroup}</span>)
          </label>
          {admin && <KeyUserSudoFields sudo={sudo} error={errors.sudo} />}
          <label className="checkbox adm-check adm-mb">
            <input
              type="checkbox"
              checked={allowTunnels}
              onChange={(e) => {
                setAllowTunnels(e.target.checked);
                setTunnelsTouched(true);
              }}
            />
            Permitir túneles SSH (sin esto no puede reenviar puertos hacia <span className="mono">127.0.0.1</span>)
          </label>
          <label className="checkbox adm-check">
            <input type="checkbox" checked={linger} onChange={(e) => setLinger(e.target.checked)} />
            Activar linger (sus servicios de usuario y contenedores siguen activos sin sesión abierta)
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Revisar comandos…
          </button>
        </div>
      </form>
    </AdmModal>
  );
}
