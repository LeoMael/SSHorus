// Botón «Panel de VPS» de la barra lateral (siempre visible, junto al título «Servidores»).
import { LayoutDashboard } from "lucide-react";
import { openFleet } from "../../features/fleet/tabs";
import "./FleetButton.css";

export function FleetButton({ disabled }: { disabled?: boolean }) {
  return (
    <button className="fl-sb-btn" title="Panel de VPS: estado de todos tus servidores" disabled={disabled} onClick={() => openFleet()}>
      <LayoutDashboard size={12} /> Panel de VPS
    </button>
  );
}
