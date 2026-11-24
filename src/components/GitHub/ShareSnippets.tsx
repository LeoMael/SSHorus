// Compartir e importar colecciones de comandos (gists o archivos de GitHub).
import { useEffect, useMemo, useState } from "react";
import { Download, Share2 } from "lucide-react";
import { github, type GhGistInfo } from "../../api/github";
import type { Snippet } from "../../api/types";
import { confirmDialog } from "../ui/dialogs";
import { toast } from "../../stores/toasts";
import { useSnippets } from "../../features/commands/state";
import { useGitHub } from "../../features/github/store";
import { Card, ErrorBox, Link } from "./parts";

export function ShareImport() {
  const mine = useSnippets((s) => s.list);
  const save = useSnippets((s) => s.save);
  const load = useSnippets((s) => s.load);
  const loaded = useSnippets((s) => s.loaded);
  const [src, setSrc] = useState("");
  const [list, setList] = useState<Snippet[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const exists = (s: Snippet) => mine.some((m) => m.name === s.name && m.command === s.command);

  const fetchIt = async () => {
    setBusy(true);
    setError(null);
    setList(null);
    try {
      const l = await github.fetchSnippets(src);
      setList(l);
      setPicked(new Set(l.map((s, i) => (exists(s) ? -1 : i)).filter((i) => i >= 0)));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const importIt = async () => {
    if (!list) return;
    const chosen = list.filter((_, i) => picked.has(i));
    const dangerous = chosen.filter((s) => s.dangerous || s.sudo).length;
    const ok = await confirmDialog({
      title: `¿Importar ${chosen.length} comandos?`,
      message: (
        <>
          Se añadirán a «Mis comandos». Revisa lo que hace cada uno antes de ejecutarlo: vienen de otra persona.
          {dangerous > 0 && <b> {dangerous} usan sudo o están marcados como peligrosos.</b>}
        </>
      ),
      confirmText: "Importar",
    });
    if (!ok) return;
    let n = 0;
    for (const s of chosen) if (await save({ ...s, id: "" })) n++;
    toast.success(`Importados ${n} comandos`);
    setList(null);
    setSrc("");
  };

  const toggle = (i: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <Card title="Importar comandos compartidos">
      <form
        className="gh-inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (src.trim() && !busy) void fetchIt();
        }}
      >
        <input
          className="input mono"
          placeholder="Enlace de gist, de un archivo de GitHub (…/blob/…) o raw.githubusercontent.com"
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          aria-label="Origen de la colección"
        />
        <button className="btn btn-sm" type="submit" disabled={!src.trim() || busy}>
          {busy ? <span className="spinner" /> : <Download size={13} />} Ver
        </button>
      </form>
      <ErrorBox error={error} />
      {list && (
        <>
          <div className="gh-list gh-list-short">
            {list.map((s, i) => (
              <label key={i} className="gh-row gh-row-check">
                <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
                <span className="gh-row-main">
                  <span className="gh-row-title">
                    {s.name} {exists(s) && <span className="gh-tag">ya lo tienes</span>}
                    {(s.dangerous || s.sudo) && <span className="gh-tag gh-tag-warn">{s.sudo ? "sudo" : "peligroso"}</span>}
                  </span>
                  <span className="gh-row-sub mono">{s.command}</span>
                </span>
                <span className="gh-hint">{s.category}</span>
              </label>
            ))}
          </div>
          <button className="btn btn-primary btn-sm" disabled={picked.size === 0} onClick={() => void importIt()}>
            Importar {picked.size} seleccionados
          </button>
        </>
      )}
    </Card>
  );
}

export function SharePublish() {
  const connected = useGitHub((s) => s.connected);
  const mine = useSnippets((s) => s.list);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [desc, setDesc] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GhGistInfo | null>(null);
  const [error, setError] = useState<unknown>(null);
  const sorted = useMemo(() => [...mine].sort((a, b) => a.name.localeCompare(b.name)), [mine]);

  const publish = async () => {
    const chosen = mine.filter((s) => picked.has(s.id));
    const ok = await confirmDialog({
      title: `¿Publicar ${chosen.length} comandos?`,
      message: isPublic
        ? "El gist será público: cualquiera podrá verlo y encontrarlo."
        : "El gist será secreto: no aparece en búsquedas, pero cualquiera con el enlace puede verlo.",
      confirmText: "Publicar",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await github.shareSnippets(chosen, desc, isPublic));
      toast.success("Comandos publicados");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!connected) return null;
  return (
    <Card title="Publicar mis comandos en un gist">
      {sorted.length === 0 ? (
        <div className="gh-hint">Aún no tienes comandos propios.</div>
      ) : (
        <div className="gh-list gh-list-short">
          {sorted.map((s) => (
            <label key={s.id} className="gh-row gh-row-check">
              <input
                type="checkbox"
                checked={picked.has(s.id)}
                onChange={() =>
                  setPicked((p) => {
                    const n = new Set(p);
                    if (n.has(s.id)) n.delete(s.id);
                    else n.add(s.id);
                    return n;
                  })
                }
              />
              <span className="gh-row-main">
                <span className="gh-row-title">{s.name}</span>
                <span className="gh-row-sub mono">{s.command}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="gh-inline">
        <input className="input" placeholder="Descripción del gist" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <label className="checkbox">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          <span>Público</span>
        </label>
        <button className="btn btn-sm" disabled={picked.size === 0 || busy} onClick={() => void publish()}>
          {busy ? <span className="spinner" /> : <Share2 size={13} />} Publicar
        </button>
      </div>
      <ErrorBox error={error} />
      {result && (
        <p className="gh-hint">
          Publicado: <Link href={result.htmlUrl}>{result.htmlUrl}</Link>. Comparte este enlace para que otros lo importen.
        </p>
      )}
    </Card>
  );
}
