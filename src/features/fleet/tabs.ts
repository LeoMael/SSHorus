// Pestañas del Panel de VPS: una por ámbito («Todos los VPS» y una por proyecto). Van en la misma
// barra que las de servidor y comparten la pestaña activa (`useTabs.activeTabId`), pero se guardan
// aparte, como las de «Este equipo»: nada de lo que trabaja con sesiones SSH las toma por un servidor.
import { create } from "zustand";
import type { Project } from "../../api/types";
import { useTabs } from "../../stores/tabs";
import { pickNeighbor } from "../localterm/logic";
import { moveById } from "../../lib/tabOrder";

export interface FleetTab {
  /** «fleet-all» o «fleet-<proyecto>» (nunca choca con un sessionId ni con una local). */
  id: string;
  /** Solo los VPS de este proyecto; null = todos. */
  projectId: string | null;
}

export const useFleetTabs = create<{ tabs: FleetTab[] }>(() => ({ tabs: [] }));

const tabId = (projectId: string | null) => `fleet-${projectId ?? "all"}`;

/** Abre la pestaña del panel de ese ámbito (o la enfoca si ya existe). */
export function openFleet(projectId: string | null = null): void {
  const id = tabId(projectId);
  if (!useFleetTabs.getState().tabs.some((t) => t.id === id)) {
    useFleetTabs.setState((s) => ({ tabs: [...s.tabs, { id, projectId }] }));
  }
  useTabs.getState().setActive(id);
}

export function isFleetTabId(id: string | null | undefined): boolean {
  return !!id && useFleetTabs.getState().tabs.some((t) => t.id === id);
}

export const fleetTabIds = () => useFleetTabs.getState().tabs.map((t) => t.id);

/** Cierra la pestaña (sus conexiones se cierran con la última; ver runtime.ts). Si era la activa, se
 *  muestra otro panel o, si no queda ninguno, lo decide `initTabFallback`. */
export function closeFleetTab(id: string): void {
  const next = pickNeighbor(fleetTabIds(), id);
  useFleetTabs.setState((s) => ({ tabs: s.tabs.filter((t) => t.id !== id) }));
  if (useTabs.getState().activeTabId === id) useTabs.setState({ activeTabId: next });
}

export function moveFleetTab(id: string, toIndex: number): void {
  useFleetTabs.setState((s) => ({ tabs: moveById(s.tabs, id, toIndex) }));
}

export function fleetTabTitle(tab: FleetTab, projects: readonly Project[]): string {
  const name = tab.projectId ? projects.find((p) => p.id === tab.projectId)?.name : null;
  return name ? `Panel · ${name}` : "Panel de VPS";
}
