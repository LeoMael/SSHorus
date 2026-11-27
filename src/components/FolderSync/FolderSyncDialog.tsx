// Diálogo «Sincronizar carpeta»: elegir las dos carpetas, ver qué se subiría y unirlas.
import { useCallback, useEffect, useState } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { folderSync, type SyncPreview, type SyncSpec } from "../../api/folderSync";
import { errorMessage } from "../../api/core";
import { useProfiles } from "../../stores/profiles";
import { useTabs } from "../../stores/tabs";
import { toast } from "../../stores/toasts";
import { ALWAYS_IGNORED, ignoreText, localName, parseIgnore, previewLines, startLabel, type SyncDialogRequest } from "../../features/folderSync";
import { Modal } from "../ui/Modal";
import { confirmDialog } from "../ui/dialogs";
import { PreviewList } from "./PreviewList";

function remoteProblem(dir: string): string | null {
  const d = dir.trim();
  if (!d.startsWith("/")) return "La carpeta del servidor debe empezar por /";
  if (d.replace(/\/+$/, "") === "") return "Elige una carpeta concreta, no la raíz";
  return null;
}

export function FolderSyncDialog({ req, onClose }: { req: SyncDialogRequest; onClose: () => void }) {
  const profileId = useTabs((s) => s.tabs.find((t) => t.sessionId === req.sessionId)?.profileId ?? null);
  const savedServer = useProfiles((s) => (profileId ? !!s.getServer(profileId) : false));
  const [localDir, setLocalDir] = useState(req.spec.localDir ?? "");
  const [remoteDir, setRemoteDir] = useState(req.spec.remoteDir ?? "");
  const [ignore, setIgnore] = useState(ignoreText(req.spec.ignore ?? []));
  const [deleteRemote, setDeleteRemote] = useState(req.spec.deleteRemote ?? false);
  const [remember, setRemember] = useState(!!req.saved);
  const [overwriteNewer, setOverwriteNewer] = useState(false);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = !localDir.trim() ? "Elige una carpeta de tu PC" : remoteProblem(remoteDir);
  const spec = useCallback(
    (): SyncSpec => ({ localDir: localDir.trim(), remoteDir: remoteDir.trim(), ignore: parseIgnore(ignore), deleteRemote }),
    [localDir, remoteDir, ignore, deleteRemote],
  );

  const compare = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await folderSync.preview(req.sessionId, spec()));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [req.sessionId, spec]);

  // Con las dos carpetas ya puestas (p. ej. al reactivar una guardada), se compara al abrir.
  const ready = !!req.spec.localDir && !!req.spec.remoteDir;
  useEffect(() => {
    if (ready) void compare();
    // Solo al abrir: luego compara el botón.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changed = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPreview(null);
  };

  const pickLocal = async () => {
    const res = await openDialog({ directory: true, multiple: false, title: "Carpeta de tu PC" });
    if (typeof res === "string") changed(setLocalDir)(res);
  };

  const toggleDelete = async (on: boolean) => {
    if (on) {
      const yes = await confirmDialog({
        title: "¿Borrar también en el servidor?",
        message: "Cada archivo que borres en tu PC se borrará en el servidor. Si borras algo sin querer, también se pierde allí.",
        confirmText: "Sí, borrar también allí",
        danger: true,
      });
      if (!yes) return;
    }
    changed(setDeleteRemote)(on);
  };

  const start = async (upload: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const s = spec();
      await folderSync.start(req.sessionId, s, { upload, overwriteNewer: upload && overwriteNewer, remember: remember && savedServer });
      toast.success("Carpetas unidas", `Lo que guardes en «${localName(s.localDir)}» se subirá solo a ${s.remoteDir}`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const footer = (
    <>
      <button type="button" className="btn" onClick={onClose}>
        Cancelar
      </button>
      {!preview ? (
        <button type="button" className="btn btn-primary" disabled={busy || !!problem} title={problem ?? undefined} onClick={() => void compare()}>
          {busy ? <span className="spinner" /> : <RefreshCw size={14} />} Comparar
        </button>
      ) : (
        <>
          {preview.toUpload.length + preview.remoteNewer.length > 0 && (
            <button type="button" className="btn" disabled={busy} onClick={() => void start(false)} title="Solo se subirá lo que guardes a partir de ahora">
              Unir sin subir nada
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void start(true)}>
            {busy && <span className="spinner" />} {startLabel(preview, overwriteNewer)}
          </button>
        </>
      )}
    </>
  );

  return (
    <Modal open title="Sincronizar carpeta" onClose={onClose} footer={footer} width={560}>
      <p className="fs-intro muted">Cada vez que guardes un archivo en tu PC, se subirá solo a la carpeta del servidor. Solo en ese sentido: lo que cambie en el servidor no baja.</p>
      <label className="field">
        <span>Carpeta de tu PC</span>
        <span className="fs-pick">
          <input className="input mono" value={localDir} onChange={(e) => changed(setLocalDir)(e.target.value)} placeholder="Elige una carpeta…" spellCheck={false} />
          <button type="button" className="btn" onClick={() => void pickLocal()}>
            <FolderOpen size={14} /> Elegir…
          </button>
        </span>
      </label>
      <label className="field">
        <span>Carpeta del servidor</span>
        <input className="input mono" value={remoteDir} onChange={(e) => changed(setRemoteDir)(e.target.value)} placeholder="/var/www/html" spellCheck={false} />
      </label>
      <label className="field">
        <span>No subir (uno por línea, como .gitignore)</span>
        <textarea className="textarea mono fs-ignore" rows={3} value={ignore} onChange={(e) => changed(setIgnore)(e.target.value)} placeholder={"*.log\ndist/\n/config.local.php"} spellCheck={false} />
        <span className="faint fs-hint">Siempre se ignoran {ALWAYS_IGNORED}. También vale un archivo .sshorusignore en la carpeta de tu PC.</span>
      </label>
      <label className="checkbox fs-check">
        <input type="checkbox" checked={deleteRemote} onChange={(e) => void toggleDelete(e.target.checked)} />
        Borrar también en el servidor lo que borre en mi PC
      </label>
      {savedServer && (
        <label className="checkbox fs-check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Recordarla en este servidor (ofrecer reactivarla al conectar)
        </label>
      )}
      {error && <p className="field-error fs-error">{error}</p>}
      {preview && (
        <div className="fs-preview">
          {preview.truncated && <p className="fs-warn">La carpeta es enorme: solo se vigilan los primeros 20 000 archivos. Añade carpetas a «No subir».</p>}
          <ul className="fs-lines">
            {previewLines(preview).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <PreviewList title="Se subirán" items={preview.toUpload} />
          {preview.remoteNewer.length > 0 && (
            <>
              <PreviewList title="Más nuevos en el servidor (no se tocan)" items={preview.remoteNewer} showRemote />
              <label className="checkbox fs-check">
                <input type="checkbox" checked={overwriteNewer} onChange={(e) => setOverwriteNewer(e.target.checked)} />
                Subir también estos y reemplazar los del servidor
              </label>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
