// Permisos por servidor de un asistente emparejado: un selector por servidor y atajos para todos.
// Lo usan el diálogo «Conectar un asistente» y «Cambiar permisos» en Ajustes.
import type { McpAccess } from "../../api/mcp";
import { Segmented } from "../ui/Segmented";
import { levelOf, PAIR_LEVELS, type PairLevel } from "../../features/mcp/pairing";
import "./McpPairing.css";

interface Props {
  servers: { id: string; name: string }[];
  access: Record<string, McpAccess>;
  onChange: (next: Record<string, McpAccess>) => void;
}

export function AccessPicker({ servers, access, onChange }: Props) {
  if (servers.length === 0) return <p className="mpair-muted">Aún no tienes servidores guardados.</p>;
  const setAll = (level: PairLevel) => onChange(Object.fromEntries(servers.map((s) => [s.id, level])));
  return (
    <div className="mpair-access">
      {servers.length > 1 && (
        <div className="mpair-all">
          <span>Todos:</span>
          {PAIR_LEVELS.map((l) => (
            <button key={l.value} type="button" className="btn btn-sm" onClick={() => setAll(l.value)} title={l.title}>
              {l.label}
            </button>
          ))}
        </div>
      )}
      {servers.map((s) => (
        <div key={s.id} className="mpair-access-row">
          <span className="mpair-server">{s.name}</span>
          <Segmented<PairLevel>
            label={`Acceso a ${s.name}`}
            value={levelOf(access, s.id)}
            options={PAIR_LEVELS}
            onChange={(v) => onChange({ ...access, [s.id]: v })}
          />
        </div>
      ))}
    </div>
  );
}
