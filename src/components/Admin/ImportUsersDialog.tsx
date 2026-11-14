// «Añadir a SSHorus…»: guarda usuarios del servidor como servidores de SSHorus (mismo host y puerto).
// Elegir usuarios y cómo entrarán → (si se instala la llave) revisión del comando → resultado y prueba.
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, RefreshCw } from "lucide-react";
import type { ServerProfile } from "../../api/types";
import { buildCandidates, findLocalPublicKey, installKeyPlan, type ImportAuth, type Plan } from "../../features/admin";
import { useProfiles } from "../../stores/profiles";
import { useAdmin } from "./context";
import { AdmModal } from "./AdmModal";
import { PlanReview } from "./PlanReview";
import { ImportUsersList } from "./ImportUsersList";
import { ImportAuthFields, type AuthChoice } from "./ImportAuthFields";
import { ImportUsersDone } from "./ImportUsersDone";
import { saveImported, useLocalKeys, useUserAccess } from "./useImportUsers";
import "./ImportUsers.css";

type Step = "pick" | "review" | "saving" | "done";
const TITLE = "Añadir usuarios a SSHorus";

function defaultKeyPath(base: ServerProfile | null): string {
  return base?.auth === "key" && base.keyPath ? base.keyPath : "";
}

export function ImportUsersDialog({ onClose }: { onClose: () => void }) {
  const { sessionId, profileId, elevation, users, askSudo } = useAdmin();
  const base = useProfiles((s) => s.servers.find((x) => x.id === profileId) ?? null);
  const servers = useProfiles((s) => s.servers);
  const projects = useProfiles((s) => s.projects);
  const access = useUserAccess(sessionId, elevation, users);
  const locals = useLocalKeys();

  const [step, setStep] = useState<Step>("pick");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSystem, setShowSystem] = useState(false);
  const [auth, setAuth] = useState<AuthChoice>({ kind: "key", keyPath: defaultKeyPath(base), install: true, test: true });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ saved: ServerProfile[]; failed: number } | null>(null);
  const initialized = useRef(false);

  const candidates = useMemo(
    () => (base ? buildCandidates({ users, read: access.read, servers, host: base.host, port: base.port }) : []),
    [users, access.read, servers, base],
  );
  const chosen = candidates.filter((c) => selected.has(c.name) && !c.blocked).map((c) => c.name);
  const publicKey = locals && auth.kind === "key" ? findLocalPublicKey(locals, auth.keyPath) : null;
  const install = auth.kind === "key" && auth.install && !!publicKey;
  const projectNames = base ? projects.filter((p) => p.serverIds.includes(base.id)).map((p) => `«${p.name}»`) : [];

  // Al terminar la primera lectura: marcar los sugeridos (usuarios normales con alguna forma de entrar).
  useEffect(() => {
    if (initialized.current || access.loading || (!access.read && !access.error) || !candidates.length) return;
    initialized.current = true;
    setSelected(new Set(candidates.filter((c) => c.suggested).map((c) => c.name)));
  }, [access.loading, access.read, access.error, candidates]);

  // Sin llave en el servidor actual: proponer la primera de ~/.ssh (salvo que use el agente).
  useEffect(() => {
    if (!locals || auth.keyPath || base?.auth === "agent") return;
    const first = locals.find((l) => l.privatePath)?.privatePath;
    if (first) setAuth((a) => (a.keyPath ? a : { ...a, keyPath: first }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locals]);

  const toggle = (name: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  const create = async () => {
    if (!base) return;
    setStep("saving");
    const importAuth: ImportAuth = auth.kind === "key" ? { kind: "key", keyPath: auth.keyPath } : { kind: "password" };
    const saved = await saveImported(base, chosen, importAuth);
    setResult({ saved, failed: chosen.length - saved.length });
    setStep("done");
  };

  const next = () => {
    setError(null);
    if (!install || !publicKey) return void create();
    const p = installKeyPlan(chosen, publicKey.line);
    if (typeof p === "string") return setError(p);
    setPlan(p);
    setStep("review");
  };

  if (step === "review" && plan) {
    return (
      <AdmModal title={TITLE} onClose={onClose} width={680}>
        <PlanReview plan={plan} onBack={() => setStep("pick")} onCancel={onClose} onDone={() => void create()} runLabel="Instalar llave y añadir">
          <p className="dialog-message">
            Se añade tu llave pública a <span className="mono">~/.ssh/authorized_keys</span> de {chosen.join(", ")} (si ya está, no se
            repite). Después se guardan los servidores en SSHorus.
          </p>
        </PlanReview>
      </AdmModal>
    );
  }

  if (step === "saving" || (step === "done" && result)) {
    return (
      <AdmModal title={TITLE} onClose={onClose} width={680}>
        {result ? (
          <ImportUsersDone saved={result.saved} failed={result.failed} autoTest={auth.test} onClose={onClose} />
        ) : (
          <div className="modal-body adm-loading">
            <span className="spinner" /> Guardando servidores…
          </div>
        )}
      </AdmModal>
    );
  }

  const systemCount = candidates.filter((c) => c.kind === "system").length;
  return (
    <AdmModal title={TITLE} onClose={onClose} width={720}>
      <div className="modal-body">
        {!base ? (
          <div className="adm-note adm-note-warn">No se encontró el servidor guardado de esta pestaña: no se puede copiar su host y puerto.</div>
        ) : (
          <p className="dialog-message">
            Se crea un servidor por usuario en <span className="mono">{base.host}:{base.port || 22}</span>, con el nombre «{base.name} (usuario)»
            {projectNames.length > 0 && <> y en el proyecto {projectNames.join(", ")}</>}.
          </p>
        )}
        <div className="iu-toolbar">
          <label className="checkbox adm-check">
            <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} />
            Mostrar cuentas del sistema <span className="faint">({systemCount})</span>
          </label>
          <div className="adm-spacer" />
          {access.loading && <span className="spinner adm-spinner-btn" aria-label="Leyendo" />}
          <button className="btn btn-sm" onClick={() => setSelected(new Set(candidates.filter((c) => c.suggested).map((c) => c.name)))}>
            Sugeridos
          </button>
          <button className="btn btn-sm" onClick={() => setSelected(new Set())}>
            Ninguno
          </button>
        </div>
        {access.error && (
          <div className="adm-note adm-note-warn iu-warn">
            <span>{access.error}. Las llaves y contraseñas salen como «—».</span>
            {access.needSudo ? (
              <button className="btn btn-sm" onClick={askSudo}>
                <KeyRound size={13} /> Contraseña de sudo
              </button>
            ) : (
              <button className="btn btn-sm" onClick={access.reload}>
                <RefreshCw size={13} /> Reintentar
              </button>
            )}
          </div>
        )}
        <ImportUsersList candidates={candidates} selected={selected} onToggle={toggle} showSystem={showSystem} />
        <ImportAuthFields value={auth} onChange={setAuth} locals={locals} publicKey={publicKey} />
        {error && (
          <div className="field-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <span className="faint adm-footer-left">
          {chosen.length} {chosen.length === 1 ? "elegido" : "elegidos"}
        </span>
        <button className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={next} disabled={!base || !chosen.length}>
          {install ? "Revisar comandos…" : `Añadir ${chosen.length || ""} a SSHorus`}
        </button>
      </div>
    </AdmModal>
  );
}
