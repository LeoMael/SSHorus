// «Abrir en Administración»: la pestaña de ese servidor (conecta si no hay) en Administración → Auditoría,
// donde está su informe completo con «Arreglar», la IA y el historial.
import type { ServerProfile } from "../../api/types";
import { openAuditTab } from "../../features/audit/nav";
import { closeProjectAudit } from "../../features/audit/projectStore";
import { connectToServer } from "../../features/connect/connect";
import { useTabs } from "../../stores/tabs";

const connectedTab = (profileId: string) => useTabs.getState().tabs.find((t) => t.profileId === profileId && t.status === "connected");

export async function openServerAudit(server: ServerProfile): Promise<void> {
  let tab = connectedTab(server.id);
  if (!tab) {
    if (!(await connectToServer(server))) return;
    tab = connectedTab(server.id);
  }
  if (!tab) return;
  useTabs.getState().setActive(tab.id);
  openAuditTab(tab.sessionId);
  closeProjectAudit();
}
