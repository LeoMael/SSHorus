// Ajustes → Asistentes de IA → «Asistentes conectados»: cada IA emparejada con su carpeta, último uso y
// permisos, con «Cambiar permisos» y «Revocar».
import { useEffect, useState } from "react";
import { mcp, type McpAccess, type McpPairedClient } from "../../api/mcp";
import { formatDate } from "../../lib/format";
import { useProfiles } from "../../stores/profiles";
import { toast } from "../../stores/toasts";
import { confirmDialog } from "../ui/dialogs";
import { refreshPaired, useMcp } from "../../features/mcp/store";
import { accessSummary, cleanAccess, initialAccess, sortClients } from "../../features/mcp/pairing";
import { AccessPicker } from "./AccessPicker";
import "./McpPairing.css";

function ClientRow({ client, servers }: { client: McpPairedClient; servers: { id: string; name: string }[] }) {
  const [draft, setDraft] = useState<Record<string, McpAccess> | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      useMcp.setState({ paired: await mcp.pairedSetAccess(client.id, cleanAccess(draft)) });
      setDraft(null);
    } catch (e) {
      toast.error("No se pudieron guardar los permisos", e);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    const ok = await confirmDialog({
      title: "Revocar asistente",
      message: `${client.name} dejará de poder usar SSHorus al instante. Para volver a conectarlo tendrá que emparejarse otra vez.`,
      confirmText: "Revocar",
    });
    if (!ok) return;
    try {
      useMcp.setState({ paired: await mcp.pairedRevoke(client.id) });
      toast.success(`${client.name} revocado`);
    } catch (e) {
      toast.error("No se pudo revocar", e);
    }
  };

  return (
    <div className="mpair-client">
      <div className="mpair-client-head">
        <div className="mpair-client-info">
          <strong>{client.name}</strong>
          <small className="mono" title={client.program}>
            {client.cwd ?? "—"}
          </small>
          <small>
            Último uso: {client.lastUsed ? formatDate(client.lastUsed / 1000) : "aún no"} · {accessSummary(client.access, servers)}
          </small>
        </div>
        {!draft && (
          <div className="mpair-client-actions">
            <button className="btn btn-sm" onClick={() => setDraft(initialAccess(servers.map((s) => s.id), client.access))}>
              Cambiar permisos
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => void revoke()}>
              Revocar
            </button>
          </div>
        )}
      </div>
      {draft && (
        <div className="mpair-edit">
          <AccessPicker servers={servers} access={draft} onChange={setDraft} />
          <div className="mpair-edit-actions">
            <button className="btn btn-sm" onClick={() => setDraft(null)} disabled={busy}>
              Cancelar
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={busy}>
              Guardar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PairedAssistants() {
  const paired = useMcp((s) => s.paired);
  const servers = useProfiles((s) => s.servers);
  useEffect(() => {
    void refreshPaired();
  }, []);
  if (paired.length === 0) return <div className="st-block mpair-muted">Aún no hay asistentes conectados.</div>;
  return (
    <>
      {sortClients(paired).map((c) => (
        <ClientRow key={c.id} client={c} servers={servers} />
      ))}
    </>
  );
}
