// Al conectar a un servidor con sincronizaciones guardadas, ofrecer reactivarlas (con la
// comparación de siempre: nada se sube sin verlo antes).
import { folderSync, type SavedSync } from "../../api/folderSync";
import { useProfiles } from "../../stores/profiles";
import { useTabs } from "../../stores/tabs";
import { toast } from "../../stores/toasts";
import { findActive, specOf, syncLabel } from "./model";
import { useFolderSyncs } from "./store";

/** Como mucho tantos avisos por conexión. */
const MAX_OFFERS = 3;

function offer(sessionId: string, s: SavedSync) {
  const spec = specOf(s);
  toast.info("Sincronización guardada", syncLabel(spec), {
    ms: 12000,
    action: { label: "Reactivar", onClick: () => useFolderSyncs.getState().openDialog({ sessionId, spec, saved: true }) },
  });
}

async function offerFor(sessionId: string, profileId: string) {
  if (!useProfiles.getState().getServer(profileId)) return;
  let saved: SavedSync[];
  try {
    saved = await folderSync.saved(profileId);
  } catch {
    return;
  }
  const active = useFolderSyncs.getState().list;
  saved
    .filter((s) => !findActive(active, sessionId, s.remoteDir))
    .slice(0, MAX_OFFERS)
    .forEach((s) => offer(sessionId, s));
}

let started = false;

/** Se suscribe a las pestañas nuevas (una sola vez). */
export function initReactivation(): void {
  if (started) return;
  started = true;
  useTabs.subscribe((s, prev) => {
    if (s.tabs.length <= prev.tabs.length) return;
    const old = new Set(prev.tabs.map((t) => t.id));
    for (const t of s.tabs) if (!old.has(t.id) && t.status === "connected") void offerFor(t.sessionId, t.profileId);
  });
}
