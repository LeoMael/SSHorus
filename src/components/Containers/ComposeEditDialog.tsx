// «Editar compose»: el archivo compose del proyecto en el editor de SSHorus, leído y guardado como su
// dueño (con sudo si es de otro usuario o de root). Guarda encima del archivo (conserva dueño, grupo y
// permisos) y la primera vez hace una copia `.bak-sshorus-<fecha>`. Después, «Aplicar cambios (up -d)».
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Play } from "lucide-react";
import {
  composeFilePath,
  findComposeFileScript,
  parseReadFile,
  parseStatFile,
  parseWriteFile,
  readFileScript,
  statFileScript,
  writeFileScript,
  type FileMeta,
} from "../../features/containers/composeFile";
import { formatBytes } from "../../lib/format";
import { confirmDialog } from "../ui/dialogs";
import { AdmModal } from "../ui/AdmModal";
import type { EditorIo } from "../Editor/editorIo";
import type { RemoteEditorHandle } from "../Editor/RemoteEditor";
import { useShortcutText } from "../../features/shortcuts/shortcuts";
import { useCt } from "./context";
import type { ComposeProject } from "./ComposeProjectView";
import "./ComposeJobs.css";

const RemoteEditor = lazy(() => import("../Editor/RemoteEditor"));

interface Props {
  p: ComposeProject;
  onApply: () => void;
  onClose: () => void;
}

export function ComposeEditDialog({ p, onApply, onClose }: Props) {
  const ct = useCt();
  const [path, setPath] = useState<string | null>(() => composeFilePath(p.dir, p.file));
  const [findError, setFindError] = useState<string | null>(null);
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [backup, setBackup] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const editor = useRef<RemoteEditorHandle>(null);
  const backupDone = useRef(false);
  const other = p.owner !== "self";
  const who = ct.ownerLabel(p.owner);
  const saveKeys = useShortcutText("editor.save");

  // Sin archivo conocido: el primero de la carpeta (compose.yaml, compose.yml…).
  useEffect(() => {
    if (path) return;
    void ct.runRawAs(p.owner, findComposeFileScript(p.dir), 15).then((r) => {
      const found = r.result?.stdout.trim().split("\n")[0];
      if (r.ok && found?.startsWith("/")) setPath(found);
      else setFindError(r.error ?? `No hay ningún archivo compose en ${p.dir}`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const io: EditorIo | null = useMemo(() => {
    if (!path) return null;
    const run = async (script: string) => {
      const r = await ct.runRawAs(p.owner, script, 30);
      if (!r.ok || !r.result) throw new Error(r.error ?? "Sin respuesta del servidor");
      return r.result.stdout;
    };
    return {
      read: async () => {
        const f = parseReadFile(await run(readFileScript(path)));
        if (f.kind === "missing") throw new Error(`El archivo ${path} no existe`);
        if (f.kind === "toobig") throw new Error(`El archivo es demasiado grande para el editor (${formatBytes(f.meta.size)})`);
        setMeta(f.meta);
        return { content: f.content, size: f.meta.size, modified: f.meta.modified };
      },
      remoteState: async () => {
        const m = parseStatFile(await run(statFileScript(path)));
        return { exists: !!m, modified: m?.modified ?? null };
      },
      write: async (content) => {
        const w = parseWriteFile(await run(writeFileScript(path, content, !backupDone.current)));
        if (!backupDone.current) setBackup(w.backup);
        backupDone.current = true;
        setMeta(w.meta);
        setSaved(true);
        return { size: w.meta.size, modified: w.meta.modified };
      },
    };
    // ct.runRawAs cambia con el panel; el editor se queda con el primero (mismo dueño y sesión).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, p.owner]);

  const close = async () => {
    if (editor.current?.isDirty()) {
      const ok = await confirmDialog({ title: "Descartar cambios", message: "Tienes cambios sin guardar en el archivo compose. ¿Cerrar y perderlos?", confirmText: "Cerrar", danger: true });
      if (!ok) return;
    }
    onClose();
  };

  const apply = async () => {
    if (editor.current?.isDirty() && !(await editor.current.save())) return;
    onApply();
    onClose();
  };

  return (
    <AdmModal title={`Editar compose de «${p.name}»`} onClose={() => void close()} width="min(1100px, 96vw)" className="ct-edit-modal">
      <div className="ct-edit-body">
        <div className="faint ct-small">
          {other ? (
            <>
              Se lee y se guarda como el usuario <strong>{who}</strong> (con sudo).{" "}
            </>
          ) : null}
          Al guardar se escribe encima del archivo: conserva su dueño, grupo y permisos
          {meta ? ` (${meta.owner}:${meta.group}, ${meta.mode})` : ""}. La primera vez se hace antes una copia{" "}
          {backup ? (
            <>
              en <span className="mono">{backup}</span>.
            </>
          ) : (
            <span className="mono">.bak-sshorus-&lt;fecha&gt;</span>
          )}
        </div>
        {findError && (
          <div className="ct-error" role="alert">
            <AlertTriangle size={14} />
            <pre>{findError}</pre>
          </div>
        )}
        <div className="ct-edit-host">
          {path && io ? (
            <Suspense fallback={<div className="empty-state"><span className="spinner" /></div>}>
              <RemoteEditor ref={editor} sessionId={ct.sessionId} path={path} active onDirtyChange={setDirty} offline={ct.disabled} io={io} />
            </Suspense>
          ) : (
            !findError && (
              <div className="empty-state">
                <span className="spinner" />
                <div>Buscando el archivo compose…</div>
              </div>
            )
          )}
        </div>
      </div>
      <div className="modal-footer">
        <span className="faint ct-small ct-footer-left">{dirty ? `Cambios sin guardar (${saveKeys} guarda)` : saved ? "Guardado en el servidor" : ""}</span>
        <button className="btn" onClick={() => void close()}>
          Cerrar
        </button>
        <button
          className="btn btn-primary"
          disabled={(!saved && !dirty) || !io || ct.disabled}
          title="Guarda (si hace falta) y vuelve a levantar el proyecto con los cambios, en segundo plano"
          onClick={() => void apply()}
        >
          <Play size={13} /> Aplicar cambios (up -d)
        </button>
      </div>
    </AdmModal>
  );
}
