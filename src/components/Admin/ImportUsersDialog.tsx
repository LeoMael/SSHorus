// «Añadir a SSHorus…»: guarda usuarios del servidor como servidores de SSHorus (mismo host y puerto).
// Elegir usuarios, su nombre y su llave → (si hay llaves que instalar) revisión del comando → resultado y prueba.
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, RefreshCw } from "lucide-react";
import type { ServerProfile } from "../../api/types";
import {
  autoKeyPath,
  buildCandidates,
  defaultKeyPath,
  defaultServerNames,
  installKeysPlan,
  keySource,
  todayDays,
  type Plan,
} from "../../features/admin";
import { findKey } from "../../features/sshkeys/keys";
import { useLocalKeysOnMount } from "../../features/sshkeys/store";
import { useKeyUsages } from "../../features/sshkeys/useKeyUsage";
import { useProfiles } from "../../stores/profiles";
import { useAdmin } from "./context";
import { AdmModal } from "./AdmModal";
import { PlanReview } from "./PlanReview";
import { ImportUsersList } from "./ImportUsersList";
import { ImportAuthFields, type AuthChoice } from "./ImportAuthFields";
import { ImportUserOptions, type UserChoice } from "./ImportUserOptions";
import { ImportUsersDone } from "./ImportUsersDone";
import { saveImported, useImportBase, useUserAccess, type ImportItem } from "./useImportUsers";
import "./ImportUsers.css";

type Step = "pick" | "review" | "saving" | "done";
type Edit = Partial<Pick<UserChoice, "name" | "keyPath">>;
const TITLE = "Añadir usuarios a SSHorus";

export function ImportUsersDialog({ onClose }: { onClose: () => void }) {
  const { sessionId, profileId, elevation, users, askSudo } = useAdmin();
  const { found, searching } = useImportBase(sessionId, profileId);
  const base = found?.base ?? null;
  const servers = useProfiles((s) => s.servers);
  const projects = useProfiles((s) => s.projects);
  const access = useUserAccess(sessionId, elevation, users);
  const localKeys = useLocalKeysOnMount().data?.keys;
  const keys = useKeyUsages(useMemo(() => localKeys ?? [], [localKeys]));

  const [step, setStep] = useState<Step>("pick");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [showSystem, setShowSystem] = useState(false);
  const [auth, setAuth] = useState<AuthChoice>({ kind: "key", install: true, test: true });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ saved: ServerProfile[]; failed: number } | null>(null);
  const initialized = useRef(false);

  // Sin servidor (aún) se muestran igual los usuarios; solo falta saber cuáles ya están guardados.
  const candidates = useMemo(
    () => buildCandidates({ users, read: access.read, servers, host: base?.host ?? "", port: base?.port ?? 22, today: todayDays() }),
    [users, access.read, servers, base],
  );
  const names = useMemo(() => defaultServerNames(candidates.map((c) => c.name), base?.host ?? "", servers), [candidates, base, servers]);
  const fallbackKey = defaultKeyPath(base, keys);
  const choices = useMemo(() => {
    const out = new Map<string, UserChoice>();
    for (const c of candidates) {
      const e = edits[c.name] ?? {};
      const keyPath = e.keyPath ?? autoKeyPath(c.authorized, keys, fallbackKey);
      out.set(c.name, { name: e.name ?? names.get(c.name) ?? c.name, keyPath, source: keySource(keyPath, c.authorized, keys) });
    }
    return out;
  }, [candidates, edits, keys, fallbackKey, names]);

  const chosen = candidates.filter((c) => selected.has(c.name) && !c.blocked);
  const useKey = auth.kind === "key";
  const toInstall = useKey && auth.install ? chosen.filter((c) => choices.get(c.name)?.source === "install") : [];
  const projectNames = found?.saved ? projects.filter((p) => p.serverIds.includes(found.base.id)).map((p) => `«${p.name}»`) : [];

  // Al terminar la primera lectura: marcar los sugeridos (usuarios normales con alguna forma de entrar).
  useEffect(() => {
    if (initialized.current || access.loading || (!access.read && !access.error) || !candidates.length) return;
    initialized.current = true;
    setSelected(new Set(candidates.filter((c) => c.suggested).map((c) => c.name)));
  }, [access.loading, access.read, access.error, candidates]);

  const toggle = (name: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  const edit = (user: string, e: Edit) => setEdits((x) => ({ ...x, [user]: { ...x[user], ...e } }));

  const create = async () => {
    if (!base) return;
    setStep("saving");
    const items: ImportItem[] = chosen.map((c) => {
      const ch = choices.get(c.name);
      return { user: c.name, name: ch?.name ?? c.name, auth: useKey ? { kind: "key", keyPath: ch?.keyPath ?? "" } : { kind: "password" } };
    });
    const saved = await saveImported(base, items);
    setResult({ saved, failed: items.length - saved.length });
    setStep("done");
  };

  const next = () => {
    setError(null);
    if (!toInstall.length) return void create();
    const p = installKeysPlan(
      toInstall.map((c) => ({ user: c.name, publicLine: findKey(keys, choices.get(c.name)?.keyPath ?? "")?.publicLine ?? "" })),
    );
    if (typeof p === "string") return setError(p);
    setPlan(p);
    setStep("review");
  };

  if (step === "review" && plan) {
    return (
      <AdmModal title={TITLE} onClose={onClose} width={680}>
        <PlanReview plan={plan} onBack={() => setStep("pick")} onCancel={onClose} onDone={() => void create()} runLabel="Instalar llaves y añadir">
          <p className="dialog-message">
            Se añade la llave pública elegida a <span className="mono">~/.ssh/authorized_keys</span> de {toInstall.map((c) => c.name).join(", ")}{" "}
            (si ya está, no se repite). Después se guardan los servidores en SSHorus.
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
    <AdmModal title={TITLE} onClose={onClose} width={760}>
      <div className="modal-body">
        {!base ? (
          <div className={searching ? "adm-note" : "adm-note adm-note-warn"}>
            {searching ? "Buscando el host y el puerto de esta conexión…" : "No se encontró el host y el puerto de esta conexión: no se pueden guardar."}
          </div>
        ) : (
          <p className="dialog-message">
            Se crea un servidor por usuario en <span className="mono">{base.host}:{base.port || 22}</span>
            {projectNames.length > 0 && <> y en el proyecto {projectNames.join(", ")}</>}. Puedes cambiar el nombre y la llave de cada uno.
            {!found?.saved && <> Esta conexión no es un servidor guardado: se usan su host y su puerto.</>}
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
        <ImportUsersList
          candidates={candidates}
          selected={selected}
          onToggle={toggle}
          showSystem={showSystem}
          renderOptions={(c) => {
            const ch = choices.get(c.name);
            return (
              ch && (
                <ImportUserOptions
                  user={c.name}
                  choice={ch}
                  keys={keys}
                  useKey={useKey}
                  install={auth.install}
                  sudoWarning={c.account.sudoWarning}
                  onName={(name) => edit(c.name, { name })}
                  onKey={(keyPath) => edit(c.name, { keyPath })}
                />
              )
            );
          }}
        />
        <ImportAuthFields value={auth} onChange={setAuth} defaultKeyName={findKey(keys, fallbackKey)?.name ?? fallbackKey} />
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
          {toInstall.length ? "Revisar comandos…" : `Añadir ${chosen.length || ""} a SSHorus`}
        </button>
      </div>
    </AdmModal>
  );
}
