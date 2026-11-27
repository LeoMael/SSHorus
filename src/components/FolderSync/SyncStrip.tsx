// Sincronizaciones activas, encima del panel de transferencias: estado, último archivo subido,
// pausar y quitar. También monta el diálogo y el aviso de reactivar las guardadas.
import { useEffect, useState } from "react";
import { CircleAlert, Pause, Play, RefreshCcw, TriangleAlert, X } from "lucide-react";
import { folderSync, type SyncInfo } from "../../api/folderSync";
import { useTabs } from "../../stores/tabs";
import { toast } from "../../stores/toasts";
import { initFolderSyncs, initReactivation, lastText, statusText, syncLabel, useFolderSyncs } from "../../features/folderSync";
import { confirmDialog } from "../ui/dialogs";
import { FolderSyncDialog } from "./FolderSyncDialog";
import "./FolderSync.css";

async function act(what: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    toast.error(`No se pudo ${what}`, e);
  }
}

async function removeSync(i: SyncInfo, profileId: string | null) {
  const yes = await confirmDialog({
    title: "¿Dejar de sincronizar?",
    message: `${syncLabel(i.spec)}. Lo ya subido se queda en el servidor.${i.remembered ? " También se olvidará para las próximas conexiones." : ""}`,
    confirmText: "Dejar de sincronizar",
  });
  if (!yes) return;
  await act("quitar la sincronización", async () => {
    await folderSync.remove(i.id);
    if (i.remembered && profileId) await folderSync.forget(profileId, i.spec);
  });
}

function SyncRow({ i, now }: { i: SyncInfo; now: number }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.sessionId === i.sessionId));
  const paused = i.state === "paused";
  const last = lastText(i, now);
  return (
    <div className={`fs-row fs-${i.state}`}>
      <RefreshCcw size={13} className={i.state === "uploading" ? "fs-ico fs-spin" : "fs-ico"} />
      <span className="fs-name" title={`${i.spec.localDir} → ${tab?.title ?? "servidor"}:${i.spec.remoteDir}`}>
        {syncLabel(i.spec)}
        {tab && <span className="faint"> · {tab.title}</span>}
      </span>
      <span className="fs-status" title={i.error ?? undefined}>
        {i.state === "error" && <CircleAlert size={12} />} {statusText(i)}
      </span>
      {i.warning && (
        <span className="fs-warn-ico" title={i.warning}>
          <TriangleAlert size={12} />
        </span>
      )}
      <span className="fs-last faint">{last ?? `${i.files.toLocaleString("es")} archivos vigilados`}</span>
      <button type="button" className="icon-btn" title={paused ? "Reanudar" : "Pausar"} aria-label={paused ? "Reanudar" : "Pausar"} onClick={() => void act(paused ? "reanudar" : "pausar", () => folderSync.pause(i.id, !paused))}>
        {paused ? <Play size={13} /> : <Pause size={13} />}
      </button>
      <button type="button" className="icon-btn" title="Dejar de sincronizar" aria-label="Dejar de sincronizar" onClick={() => void removeSync(i, tab?.profileId ?? null)}>
        <X size={13} />
      </button>
    </div>
  );
}

export function SyncStrip() {
  const list = useFolderSyncs((s) => s.list);
  const dialog = useFolderSyncs((s) => s.dialog);
  const closeDialog = useFolderSyncs((s) => s.closeDialog);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void initFolderSyncs();
    initReactivation();
  }, []);

  // «hace 5 s» se actualiza solo mientras haya algo que mostrar.
  useEffect(() => {
    if (!list.length) return;
    const t = setInterval(() => !document.hidden && setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [list.length]);

  return (
    <>
      {list.length > 0 && (
        <div className="fs-strip" aria-label="Carpetas sincronizadas">
          {list.map((i) => (
            <SyncRow key={i.id} i={i} now={now} />
          ))}
        </div>
      )}
      {dialog && <FolderSyncDialog key={`${dialog.sessionId}:${dialog.spec.remoteDir ?? ""}:${dialog.spec.localDir ?? ""}`} req={dialog} onClose={closeDialog} />}
    </>
  );
}
