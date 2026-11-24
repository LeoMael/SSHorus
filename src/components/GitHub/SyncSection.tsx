// Sincronizar configuración (gist privado cifrado) y sección de comandos compartidos.
import { useEffect, useState } from "react";
import { CloudDownload, CloudUpload } from "lucide-react";
import { github, type GhConfig, type GhGistInfo } from "../../api/github";
import type { Snippet } from "../../api/types";
import { confirmDialog } from "../ui/dialogs";
import { toast } from "../../stores/toasts";
import { useProfiles } from "../../stores/profiles";
import { useSnippets } from "../../features/commands/state";
import { useGitHub } from "../../features/github/store";
import {
  buildPayload,
  countStates,
  parsePayload,
  planImport,
  projectToSave,
  serverToSave,
  snippetToSave,
  type ImportPlan,
  type PlanItem,
} from "../../features/github/sync";
import { Card, ErrorBox, Link, SectionHead, formatDate } from "./parts";
import { ShareImport, SharePublish } from "./ShareSnippets";

const MIN_PASS = 8;

function useLocalData() {
  const servers = useProfiles((s) => s.servers);
  const projects = useProfiles((s) => s.projects);
  const loadedP = useProfiles((s) => s.loaded);
  const loadP = useProfiles((s) => s.load);
  const snippets = useSnippets((s) => s.list);
  const loadedS = useSnippets((s) => s.loaded);
  const loadS = useSnippets((s) => s.load);
  useEffect(() => {
    if (!loadedP) void loadP();
    if (!loadedS) void loadS();
  }, [loadedP, loadP, loadedS, loadS]);
  return { servers, projects, snippets, ready: loadedP && loadedS };
}

function GistLabel({ g }: { g: GhGistInfo }) {
  return (
    <>
      <Link href={g.htmlUrl}>gist {g.id.slice(0, 8)}</Link>
      {g.updatedAt && <span className="gh-hint"> · actualizado {formatDate(g.updatedAt)}</span>}
    </>
  );
}

function Push({ cfg, onDone }: { cfg: GhConfig | null; onDone: () => void }) {
  const { servers, projects, snippets, ready } = useLocalData();
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<GhGistInfo | null>(null);

  const problem =
    pass.length < MIN_PASS ? `La frase debe tener al menos ${MIN_PASS} caracteres` : pass !== pass2 ? "Las frases no coinciden" : null;

  const push = async () => {
    setBusy(true);
    setError(null);
    try {
      const g = await github.syncPush(buildPayload(servers, projects, snippets), pass, cfg?.syncGistId);
      setResult(g);
      setPass("");
      setPass2("");
      toast.success("Configuración subida", "Copia cifrada en tu gist privado");
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Subir esta configuración">
      <p className="gh-hint">
        Se suben <b>{servers.length}</b> servidores, <b>{projects.length}</b> proyectos y <b>{snippets.length}</b> comandos
        propios a un gist secreto de tu cuenta, cifrados con tu frase (AES-256-GCM + Argon2id): aunque alguien viera el
        gist, sin la frase no puede leerlo. Las contraseñas y llaves privadas <b>no</b> se suben. Guarda la frase: sin
        ella no se puede recuperar la copia.
      </p>
      {cfg?.syncGistId && (
        <p className="gh-hint">
          Destino: gist <span className="mono">{cfg.syncGistId.slice(0, 8)}</span>
          {cfg.syncUpdatedAt && ` · última subida ${formatDate(cfg.syncUpdatedAt)}`}
        </p>
      )}
      <div className="field-row">
        <label className="field">
          <span>Frase de paso</span>
          <input className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
        </label>
        <label className="field">
          <span>Repite la frase</span>
          <input className="input" type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
        </label>
      </div>
      {pass && problem && <div className="field-error">{problem}</div>}
      <ErrorBox error={error} />
      <div className="gh-inline">
        <button className="btn btn-primary btn-sm" disabled={!ready || !!problem || busy} onClick={() => void push()}>
          {busy ? <span className="spinner" /> : <CloudUpload size={13} />} Subir copia cifrada
        </button>
        {busy && <span className="gh-hint">Cifrando…</span>}
        {result && <GistLabel g={result} />}
      </div>
    </Card>
  );
}

function PlanList<T>({ title, items, label }: { title: string; items: PlanItem<T>[]; label: (x: T) => string }) {
  const c = countStates(items);
  if (items.length === 0) return null;
  return (
    <details className="gh-plan">
      <summary>
        {title}: <b>{c.new}</b> nuevos · <b>{c.changed}</b> distintos · {c.same} iguales
      </summary>
      <ul>
        {items.map((i, n) => (
          <li key={n} className={`gh-plan-${i.state}`}>
            <span className="gh-tag">{i.state === "new" ? "nuevo" : i.state === "changed" ? "distinto" : "igual"}</span>{" "}
            {label(i.remote)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Pull({ cfg, onDone }: { cfg: GhConfig | null; onDone: () => void }) {
  const local = useLocalData();
  const saveServer = useProfiles((s) => s.saveServer);
  const saveProject = useProfiles((s) => s.saveProject);
  const saveSnippet = useSnippets((s) => s.save);
  const [found, setFound] = useState<GhGistInfo[] | null>(null);
  const [gistId, setGistId] = useState<string>("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [source, setSource] = useState<{ gist: GhGistInfo; exportedAt: string } | null>(null);
  const [addNew, setAddNew] = useState(true);
  const [update, setUpdate] = useState(false);

  useEffect(() => {
    github
      .syncFind()
      .then((l) => {
        setFound(l);
        setGistId((cur) => cur || cfg?.syncGistId || l[0]?.id || "");
      })
      .catch((e) => {
        setFound([]);
        setError(e);
      });
  }, [cfg?.syncGistId]);

  const fetchIt = async () => {
    setBusy(true);
    setError(null);
    setPlan(null);
    try {
      const r = await github.syncPull(pass, gistId || null);
      const payload = parsePayload(r.payload);
      setPlan(planImport(payload, local));
      setSource({ gist: r.gist, exportedAt: payload.exportedAt });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!plan) return;
    const want = (i: PlanItem<unknown>) => (i.state === "new" && addNew) || (i.state === "changed" && update);
    const nS = plan.servers.filter(want).length;
    const nP = plan.projects.filter(want).length;
    const nC = plan.snippets.filter(want).length;
    if (nS + nP + nC === 0) {
      toast.info("No hay nada que importar con estas opciones");
      return;
    }
    const ok = await confirmDialog({
      title: "¿Importar la configuración?",
      message: (
        <>
          Se guardarán {nS} servidores, {nP} proyectos y {nC} comandos.
          {update && " Los que ya existen y son distintos se sobrescribirán con la versión del gist."} No se borra nada
          de lo que ya tienes. Las contraseñas habrá que escribirlas de nuevo al conectar.
        </>
      ),
      confirmText: "Importar",
      danger: update,
    });
    if (!ok) return;
    setBusy(true);
    let done = 0;
    for (const i of plan.servers) if (want(i) && (await saveServer(serverToSave(i)))) done++;
    const known = new Set(useProfiles.getState().servers.map((s) => s.id));
    for (const i of plan.projects) if (want(i) && (await saveProject(projectToSave(i, plan, known)))) done++;
    const knownProjects = new Set(useProfiles.getState().projects.map((p) => p.id));
    for (const i of plan.snippets) {
      if (!want(i)) continue;
      const s: Snippet = snippetToSave(i, plan);
      const target = s.scope === "server" ? known : s.scope === "project" ? knownProjects : null;
      if (target && (!s.scopeId || !target.has(s.scopeId))) {
        s.scope = "global";
        s.scopeId = null;
      }
      if (await saveSnippet(s)) done++;
    }
    setBusy(false);
    setPlan(null);
    toast.success(`Importados ${done} elementos`);
  };

  return (
    <Card title="Traer configuración de otra PC">
      {found && found.length === 0 && !cfg?.syncGistId && (
        <p className="gh-hint">No se encontró ninguna copia de SSHorus en tus gists. Súbela primero desde la otra PC.</p>
      )}
      {found && found.length > 1 && (
        <label className="field">
          <span>Copia</span>
          <select className="select" value={gistId} onChange={(e) => setGistId(e.target.value)}>
            {found.map((g) => (
              <option key={g.id} value={g.id}>
                {g.id.slice(0, 8)} · {formatDate(g.updatedAt)}
              </option>
            ))}
          </select>
        </label>
      )}
      <form
        className="gh-inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (pass && !busy) void fetchIt();
        }}
      >
        <input
          className="input"
          type="password"
          autoComplete="off"
          placeholder="Frase de paso"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          aria-label="Frase de paso"
        />
        <button className="btn btn-sm" type="submit" disabled={!pass || busy || !local.ready}>
          {busy && !plan ? <span className="spinner" /> : <CloudDownload size={13} />} Descargar y ver
        </button>
      </form>
      <ErrorBox error={error} />
      {plan && source && (
        <div className="gh-preview">
          <div className="gh-hint">
            <GistLabel g={source.gist} />
            {source.exportedAt && ` · copia del ${formatDate(source.exportedAt)}`}
          </div>
          <PlanList title="Servidores" items={plan.servers} label={(s) => `${s.name} (${s.username}@${s.host}:${s.port})`} />
          <PlanList title="Proyectos" items={plan.projects} label={(p) => p.name} />
          <PlanList title="Comandos" items={plan.snippets} label={(s) => `${s.name} — ${s.command}`} />
          <label className="checkbox">
            <input type="checkbox" checked={addNew} onChange={(e) => setAddNew(e.target.checked)} />
            <span>Añadir los nuevos</span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />
            <span>Sobrescribir los distintos con la versión del gist</span>
          </label>
          <div className="gh-inline">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void apply()}>
              Importar
            </button>
            <button className="btn btn-sm" onClick={() => setPlan(null)}>
              Descartar
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function SyncSection() {
  const connected = useGitHub((s) => s.connected);
  const [cfg, setCfg] = useState<GhConfig | null>(null);
  const reload = () => {
    github.configLoad().then(setCfg).catch(() => setCfg(null));
  };
  useEffect(reload, []);
  return (
    <>
      <SectionHead title="Sincronizar y compartir" />
      {connected ? (
        <>
          <Push cfg={cfg} onDone={reload} />
          <Pull cfg={cfg} onDone={reload} />
        </>
      ) : (
        <p className="gh-hint">Conecta tu cuenta para sincronizar tu configuración entre equipos con un gist privado cifrado.</p>
      )}
      <ShareImport />
      <SharePublish />
    </>
  );
}
