// Compose: lista de proyectos detectados y carpetas recordadas, con selección y alta de carpeta.
import { useEffect, useMemo, useState } from "react";
import { FolderPlus, Layers, X } from "lucide-react";
import {
  COMPOSE_FILES,
  composeFor,
  forgetComposeFolder,
  loadComposeFolders,
  rememberComposeFolder,
  validateServerPath,
  ownerKey,
  OWNER_SELF,
  q,
  type ComposeFolder,
  type ComposeTool,
} from "../../features/containers";
import { toast } from "../../stores/toasts";
import { PICK_OWNER_HINT, useCt } from "./context";
import { ComposeProjectView, type ComposeProject } from "./ComposeProjectView";

function basename(p: string): string {
  return p.replace(/\/+$/, "").split("/").pop() ?? p;
}

/** Nombre de proyecto por defecto de Compose: carpeta en minúsculas, solo [a-z0-9_-]. */
function defaultProjectName(dir: string): string {
  return basename(dir).toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

/** Expande «~» para el shell (la ruta va citada). */
function shellPath(p: string): string {
  if (p === "~") return '"$HOME"';
  if (p.startsWith("~/")) return `"$HOME"/${q(p.slice(2))}`;
  return q(p);
}

export function ComposeTab() {
  const ct = useCt();
  const { engine, res, profileId, composeTools } = ct;
  const containers = useMemo(() => res.containers.data ?? [], [res.containers.data]);
  const [saved, setSaved] = useState<ComposeFolder[]>(() => loadComposeFolders(profileId));
  const [tool, setTool] = useState<ComposeTool | null>(() => composeFor(engine, composeTools) ?? composeTools[0] ?? null);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [newDir, setNewDir] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    setTool(composeFor(engine, composeTools) ?? composeTools[0] ?? null);
  }, [engine, composeTools]);

  const ownerKeys = useMemo(() => new Set(ct.owners.map(ownerKey)), [ct.owners]);
  const fallbackOwner = ct.newOwner ?? OWNER_SELF;
  const projects = useMemo(() => {
    const map = new Map<string, ComposeProject>();
    for (const c of containers) {
      if (!c.composeProject) continue;
      const owner = c.owner ?? fallbackOwner;
      const k = `${owner}|${c.composeWorkingDir || `project:${c.composeProject}`}`;
      let p = map.get(k);
      if (!p) {
        const file = (c.composeConfigFiles ?? "").split(",")[0]?.trim() ?? "";
        p = { key: k, name: c.composeProject, dir: c.composeWorkingDir ?? "", file, saved: false, containers: [], owner };
        map.set(k, p);
      }
      p.containers.push(c);
    }
    for (const f of saved) {
      const owner = f.owner ?? (ct.allOwners ? OWNER_SELF : fallbackOwner);
      if (!ownerKeys.has(owner)) continue;
      const k = `${owner}|${f.dir}`;
      const p = map.get(k) ?? [...map.values()].find((x) => x.owner === owner && !x.dir && x.name === defaultProjectName(f.dir));
      if (p) {
        p.saved = true;
        if (!p.dir) p.dir = f.dir;
        if (!p.file) p.file = f.file;
      } else map.set(k, { key: k, name: defaultProjectName(f.dir) || basename(f.dir), dir: f.dir, file: f.file, saved: true, containers: [], owner });
    }
    return [...map.values()].sort(
      (a, b) => Number(b.containers.some((c) => c.state === "running")) - Number(a.containers.some((c) => c.state === "running")) || a.name.localeCompare(b.name),
    );
  }, [containers, saved, ownerKeys, fallbackOwner, ct.allOwners]);

  const sel = projects.find((p) => p.key === selKey) ?? projects[0] ?? null;

  const addFolder = async () => {
    const owner = ct.newOwner;
    if (!owner) return;
    const dir = newDir.trim();
    const v = validateServerPath(dir);
    if (v) {
      setAddError(v);
      return;
    }
    setAdding(true);
    setAddError(null);
    const script = [
      `if cd -- ${shellPath(dir)} 2>/dev/null; then`,
      '  echo "dir=$(pwd -P)"',
      `  for f in ${COMPOSE_FILES.join(" ")}; do if [ -f "$f" ]; then echo "file=$f"; fi; done`,
      "else echo nodir=1; fi",
    ].join("\n");
    const r = await ct.runRawAs(owner, script, 15);
    setAdding(false);
    const out = r.result?.stdout ?? "";
    if (!r.ok || /nodir=1/.test(out)) {
      setAddError(r.error ?? "Esa carpeta no existe o no tienes permiso para entrar");
      return;
    }
    const real = /^dir=(.*)$/m.exec(out)?.[1] ?? dir;
    const file = /^file=(.*)$/m.exec(out)?.[1];
    if (!file) {
      setAddError(`No hay ${COMPOSE_FILES.join(", ")} en ${real}`);
      return;
    }
    setSaved(rememberComposeFolder(profileId, real, file, owner));
    setSelKey(`${owner}|${real}`);
    setNewDir("");
    toast.success("Carpeta de Compose añadida", `${real}/${file}`);
  };

  if (!tool) {
    return (
      <div className="ct-tab-body">
        <div className="empty-state">
          <Layers size={26} />
          <div>No se encontró Compose en el servidor</div>
          <div className="faint ct-small">
            {engine === "podman"
              ? "Instala podman-compose (p. ej. «sudo dnf install podman-compose» o «sudo apt install podman-compose»)."
              : "Instala el plugin de Compose (paquete docker-compose-plugin o docker-compose-v2)."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ct-tab-body ct-compose">
      <aside className="ct-compose-list" aria-label="Proyectos">
        <div className="ct-compose-add">
          <input
            className="input mono"
            placeholder={ct.newOwner ? "/ruta/de/la/carpeta" : "Elige arriba un usuario"}
            title={ct.newOwner ? undefined : PICK_OWNER_HINT}
            disabled={!ct.newOwner}
            value={newDir}
            onChange={(e) => {
              setNewDir(e.target.value);
              setAddError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && void addFolder()}
            aria-label="Carpeta con compose.yml"
            spellCheck={false}
          />
          <button className="icon-btn" onClick={() => void addFolder()} disabled={adding || !newDir.trim() || !ct.newOwner} title="Añadir carpeta" aria-label="Añadir carpeta">
            {adding ? <span className="spinner ct-spinner-xs" /> : <FolderPlus size={14} />}
          </button>
        </div>
        {addError && <div className="field-error ct-small">{addError}</div>}
        {projects.length === 0 && <div className="faint ct-small ct-pad">Añade la carpeta de un proyecto con compose.yml. Los proyectos que ya estén levantados aparecen solos.</div>}
        <ul role="listbox" aria-label="Proyectos Compose">
          {projects.map((p) => {
            const up = p.containers.filter((c) => c.state === "running").length;
            return (
              <li
                key={p.key}
                role="option"
                aria-selected={sel?.key === p.key}
                tabIndex={0}
                className={sel?.key === p.key ? "on" : undefined}
                onClick={() => setSelKey(p.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelKey(p.key);
                  } else if (e.key === "ArrowDown") (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
                  else if (e.key === "ArrowUp") (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
                }}
              >
                <span className={`ct-dot ct-${up > 0 ? "ok" : "off"}`} />
                <span className="ct-compose-name">
                  <strong className="ct-ellipsis">
                    {p.name}
                    {ct.allOwners && <span className="ct-tag">{ct.ownerLabel(p.owner)}</span>}
                  </strong>
                  <span className="faint ct-ellipsis mono">{p.dir || "carpeta desconocida"}</span>
                </span>
                <span className="faint ct-small">{p.containers.length ? `${up}/${p.containers.length}` : ""}</span>
                {p.saved && (
                  <button
                    className="icon-btn ct-xs"
                    title="Olvidar carpeta"
                    aria-label={`Olvidar ${p.dir}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSaved(forgetComposeFolder(profileId, p.dir));
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </aside>
      <section className="ct-compose-detail">
        {sel ? (
          <ComposeProjectView
            key={sel.key}
            p={sel}
            tool={tool}
            tools={composeTools}
            setTool={setTool}
            onUsed={(dir, file) => setSaved(rememberComposeFolder(profileId, dir, file, sel.owner))}
          />
        ) : (
          <div className="empty-state">
            <Layers size={26} />
            <div>Elige o añade un proyecto</div>
          </div>
        )}
      </section>
    </div>
  );
}
