// Botón «Cerrar…» en el panel de un nodo «puerto» del mapa: abre «Cerrar puerto» para ese puerto.
import { useState } from "react";
import { Ban } from "lucide-react";
import type { MapNode, ServerSnapshot } from "../../features/infra";
import { portOfMapNode } from "../../features/portClose";
import { PortCloseDialog } from "./PortCloseDialog";

export function MapPortClose({ node, snap }: { node: MapNode; snap: ServerSnapshot }) {
  const [open, setOpen] = useState(false);
  const port = portOfMapNode(node.id, snap.ports?.ports ?? []);
  if (!port || !snap.sessionId) return null;
  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen(true)} title="Ver cómo cerrar este puerto según quién lo abre">
        <Ban size={13} /> Cerrar…
      </button>
      {open && (
        <PortCloseDialog port={port} ports={snap.ports} sessionId={snap.sessionId} profileId={snap.id} serverName={snap.name} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
