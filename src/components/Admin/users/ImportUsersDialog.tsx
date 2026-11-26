// «Añadir a SSHorus…»: guarda usuarios del servidor como servidores de SSHorus (mismo host y puerto).
// Elegir usuarios, su nombre y cómo entran → crear las llaves nuevas (en este equipo) → revisión del
// comando que las instala → guardar → prueba de conexión de cada uno.
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, RefreshCw } from "lucide-react";
import type { ServerProfile } from "../../../api/types";
import {
  buildCandidates,
  byUser,
  importItems,
  installKeysPlan,
  nameNewKeys,
  newKeyGroups,
  todayDays,
  type ImportItem,
  type NewKey,
  type Plan,
} from "../../../features/admin";
import { useLocalKeysOnMount } from "../../../features/sshkeys/store";
import { useKeyUsages } from "../../../features/sshkeys/useKeyUsage";
import { useProfiles } from "../../../stores/profiles";
import { useAdmin } from "../context";
import { AdmModal } from "../../ui/AdmModal";
import { PlanReview } from "../PlanReview";
import { ImportUsersList } from "./ImportUsersList";
import { ImportUserOptions } from "./ImportUserOptions";
import { ImportUsersDone } from "./ImportUsersDone";
import { useImportChoices } from "./useImportChoices";
import { createNewKeys, saveImported, useImportBase, useUserAccess } from "./useImportUsers";
import "./ImportUsers.css";

type Step = "pick" | "review" | "saving" | "done";
const TITLE = "Añadir usuarios a SSHorus";
const WIDTH = "min(960px, 94vw)";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function ImportUsersDialog({ onClose }: { onClose: () => void }) {
  const { sessionId, profileId, elevation, users, askSudo } = useAdmin();
  const { found, searching } = useImportBase(sessionId, profileId);
  const base = found?.base ?? null;
  const servers = useProfiles((s) => s.servers);
  const projects = useProfiles((s) => s.projects);
  const access = useUserAccess(sessionId, elevation, users);
  const local = useLocalKeysOnMount().data;
  const localKeys = local?.keys;
  const keys = useKeyUsages(useMemo(() => localKeys ?? [], [localKeys]));
  const canInstall = access.read !== null;

  const [step, setStep] = useState<Step>("pick");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSystem, setShowSystem] = useState(false);
  const [sharedKey, setSharedKey] = useState(false);
  // Llaves nuevas ya creadas (por grupo): al volver atrás se reutilizan en vez de crear otras.
  const [ready, setReady] = useState<Map<string, NewKey>>(new Map());
  const [pending, setPending] = useState<{ plan: Plan; items: ImportItem[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ saved: ServerProfile[]; failed: number } | null>(null);
  const initialized = useRef(false);

  // Sin servidor (aún) se muestran igual los usuarios; solo falta saber cuáles ya están guardados.
  const candidates = useMemo(
    () => buildCandidates({ users, read: access.read, servers, host: base?.host ?? "", port: base?.port ?? 22, today: todayDays() }),
    [users, access.read, servers, base],
  );
  const { choices, installable, edit } = useImportChoices(candidates, keys, base, servers, canInstall);

  const chosen = candidates.filter((c) => selected.has(c.name) && !c.blocked);
  const rows = chosen.flatMap((c) => {
    const ch = choices.get(c.name);
    return ch ? [{ user: c.name, name: ch.name, access: ch.access }] : [];
  });
  const newKeyUsers = rows.filter((r) => r.access.method === "new-key").map((r) => r.user);
  const groups = newKeyGroups(newKeyUsers, sharedKey);
  const newNames = nameNewKeys(groups, base?.host ?? "", localKeys?.map((k) => k.name) ?? [], new Set(ready.keys()));
  const newFiles = byUser(groups, new Map(groups.map((g) => [g.id, fileName(ready.get(g.id)?.privatePath ?? newNames.get(g.id) ?? "")])));
  const needsInstall = rows.some((r) => r.access.install);
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

  const save = async (items: ImportItem[]) => {
    if (!base) return;
    setStep("saving");
    const saved = await saveImported(base, items);
    setResult({ saved, failed: items.length - saved.length });
    setStep("done");
  };

  const next = async () => {
    setError(null);
    let made = ready;
    if (newNames.size) {
      setBusy(true);
      const { created, error: err } = await createNewKeys(newNames, local?.defaultComment ?? "");
      made = new Map([...ready, ...created]);
      setReady(made);
      setBusy(false);
      if (err) return setError(err);
    }
    const res = importItems(rows, byUser(groups, made), keys);
    if (typeof res === "string") return setError(res);
    if (!res.install.length) return void save(res.items);
    const plan = installKeysPlan(res.install);
    if (typeof plan === "string") return setError(plan);
    setPending({ plan, items: res.items });
    setStep("review");
  };

  if (step === "review" && pending) {
    const created = groups.filter((g) => ready.has(g.id));
    return (
      <AdmModal title={TITLE} onClose={onClose} width={WIDTH}>
        <PlanReview plan={pending.plan} onBack={() => setStep("pick")} onCancel={onClose} onDone={() => void save(pending.items)} runLabel="Instalar llaves y añadir">
          {created.length > 0 && (
            <div className="adm-note iu-created">
              <KeyRound size={13} /> Llaves nuevas creadas en este equipo (sin frase):
              <ul>
                {created.map((g) => (
                  <li key={g.id}>
                    <span className="mono">{ready.get(g.id)?.privatePath}</span> <span className="faint">→ {g.users.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="dialog-message">
            Se añade cada llave pública a <span className="mono">~/.ssh/authorized_keys</span> de su usuario (si ya está, no se repite). Después se
            guardan los servidores en SSHorus y se prueba la conexión.
          </p>
        </PlanReview>
      </AdmModal>
    );
  }

  if (step === "saving" || (step === "done" && result)) {
    return (
      <AdmModal title={TITLE} onClose={onClose} width={WIDTH}>
        {result ? (
          <ImportUsersDone saved={result.saved} failed={result.failed} onClose={onClose} />
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
    <AdmModal title={TITLE} onClose={onClose} width={WIDTH} className="iu-modal">
      <div className="modal-body iu-body">
        {!base ? (
          <div className={searching ? "adm-note" : "adm-note adm-note-warn"}>
            {searching ? "Buscando el host y el puerto de esta conexión…" : "No se encontró el host y el puerto de esta conexión: no se pueden guardar."}
          </div>
        ) : (
          <p className="dialog-message">
            Se crea un servidor por usuario en <span className="mono">{base.host}:{base.port || 22}</span>
            {projectNames.length > 0 && <> y en el proyecto {projectNames.join(", ")}</>}. Por defecto cada uno entra con la llave que ya tiene
            autorizada o, si no tiene ninguna, con una llave nueva que se crea y se instala. Al terminar se prueba la conexión.
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
            <span>{access.error}. Sin sudo no se ven sus llaves ni se pueden instalar: solo queda la contraseña o una llave tuya ya puesta.</span>
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
                  name={ch.name}
                  access={ch.access}
                  methods={ch.methods}
                  authorized={ch.authorized}
                  installable={installable}
                  newKeyPath={`~/.ssh/${newFiles.get(c.name) ?? ""}`}
                  canInstall={canInstall}
                  sudoWarning={c.account.sudoWarning}
                  onName={(name) => edit(c.name, { name })}
                  onEdit={(e) => edit(c.name, e)}
                />
              )
            );
          }}
        />
        {newKeyUsers.length > 1 && (
          <label className="checkbox adm-check iu-shared">
            <input type="checkbox" checked={sharedKey} onChange={(e) => setSharedKey(e.target.checked)} />
            Usar una sola llave nueva para los {newKeyUsers.length} usuarios (si no, una por usuario)
          </label>
        )}
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
        <button className="btn btn-primary" onClick={() => void next()} disabled={!base || !chosen.length || busy}>
          {busy && <span className="spinner adm-spinner-btn" />}
          {busy ? "Creando llaves…" : needsInstall ? "Revisar comandos…" : `Añadir ${chosen.length || ""} a SSHorus`}
        </button>
      </div>
    </AdmModal>
  );
}
