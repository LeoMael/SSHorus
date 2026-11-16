// «Asistente con contexto» en una terminal local ya abierta: lanza Claude Code, Codex, agy u
// OpenCode en esa misma pestaña, con el contexto de SSHorus y el MCP igual que los botones rápidos,
// en la carpeta donde está la shell. Y «Copiar contexto», para pegarlo a mano.
//   await launchHere(tabId, "claude")
//   await copyContextHere(tabId)
import type { AiTool } from "../../api/localterm";
import { clipboard } from "../../lib/clipboard";
import { toast } from "../../stores/toasts";
import { plainContext, prepareAssistant } from "./launch";
import { assistant } from "./logic";
import { getLocalController, getLocalSession, updateLocalTab, useLocalTabs } from "./store";

/** Carpeta en la que está ahora la shell de la pestaña (o la de inicio si no se sabe). */
async function shellCwd(tabId: string): Promise<{ cwd: string | null; busy: boolean }> {
  const tabCwd = useLocalTabs.getState().tabs.find((t) => t.id === tabId)?.cwd ?? null;
  const session = getLocalSession(tabId);
  const st = session ? await session.shellState().catch(() => null) : null;
  return { cwd: st?.cwd ?? tabCwd, busy: st?.busy === true };
}

/** Abre `tool` encima de la shell de la pestaña `tabId`. Al salir del asistente, se vuelve a la shell. */
export async function launchHere(tabId: string, tool: AiTool): Promise<void> {
  const session = getLocalSession(tabId);
  const ctrl = getLocalController(tabId);
  if (!session?.isOpen() || !ctrl?.isRunning()) {
    toast.info("La terminal no está abierta", "Pulsa Enter en la terminal para abrir una shell y vuelve a intentarlo.");
    return;
  }
  if (session.hasTop()) {
    toast.info("Ya hay un asistente abierto en esta terminal", "Sal de él (por ejemplo con /exit) para abrir otro.");
    return;
  }
  const { cwd, busy } = await shellCwd(tabId);
  if (busy) {
    toast.info("La terminal está ocupada", "Termina antes el programa que está en marcha (por ejemplo con Ctrl+C).");
    return;
  }
  const prepared = await prepareAssistant(tool, cwd);
  if (!prepared) return;
  const label = assistant(tool).label;
  ctrl.note(`\n${prepared.intro.join("\n")}`);
  updateLocalTab(tabId, { here: tool, aiAlive: true });
  try {
    const r = await session.runOnTop(prepared.launch, cwd, () => {
      updateLocalTab(tabId, { here: null, aiAlive: false, mcp: false });
      getLocalController(tabId)?.note(`— ${label} terminó: de vuelta en la shell —`);
    });
    if (!r) return;
    updateLocalTab(tabId, { mcp: r.mcp });
    if (r.warning) ctrl.note(r.warning);
    ctrl.focus();
  } catch (e) {
    updateLocalTab(tabId, { here: null, aiAlive: false });
    toast.error(`No se pudo abrir ${label}`, e);
  }
}

/** Copia el contexto de SSHorus (sin MCP, sin contraseñas, llaves ni tokens) para pegarlo a mano. */
export async function copyContextHere(tabId: string): Promise<void> {
  try {
    const text = await plainContext((await shellCwd(tabId)).cwd);
    if (!text) {
      toast.info("No hay contexto que copiar", "Está desactivado en Ajustes → Asistentes de IA.");
      return;
    }
    await clipboard.write(text);
    toast.info("Contexto copiado", "Pégalo como primer mensaje en el asistente. No lleva contraseñas, llaves ni tokens.");
  } catch (e) {
    toast.error("No se pudo copiar el contexto", e);
  }
}
