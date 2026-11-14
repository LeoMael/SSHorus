// Todas las pestañas de la barra, sean de servidor, de «Este equipo» o del Panel de VPS.
import { useTabs } from "../../stores/tabs";
import { fleetTabIds } from "../fleet/tabs";
import { sshAndLocalTabIds } from "../localterm/store";

/** En el orden de la barra: servidor, este equipo, paneles. */
export function barTabIds(): string[] {
  return [...sshAndLocalTabIds(), ...fleetTabIds()];
}

let initialized = false;

/** Llamar una vez al iniciar la app: si al cerrar una pestaña no queda ninguna activa, mostrar la última de la barra. */
export function initTabFallback() {
  if (initialized) return;
  initialized = true;
  useTabs.subscribe((s, prev) => {
    if (s.activeTabId !== null || prev.activeTabId === null) return;
    const ids = barTabIds();
    if (ids.length > 0) useTabs.setState({ activeTabId: ids[ids.length - 1] });
  });
}
