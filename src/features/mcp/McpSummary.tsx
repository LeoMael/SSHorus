// Resumen de un vistazo: qué puede hacer el asistente en cada servidor (nivel, tareas y protegidos).
import type { McpConfig } from "../../api/mcp";
import { useProfiles } from "../../stores/profiles";
import { summarize } from "./accessInfo";
import "./Mcp.css";

export function McpSummary({ cfg }: { cfg: McpConfig | null }) {
  const servers = useProfiles((s) => s.servers);
  if (servers.length === 0) return null;
  return (
    <table className="mcp-summary">
      <thead>
        <tr>
          <th>Servidor</th>
          <th>Nivel</th>
          <th>Qué puede cambiar</th>
          <th>Protegidos</th>
        </tr>
      </thead>
      <tbody>
        {servers.map((s) => {
          const r = summarize(cfg, s.id);
          return (
            <tr key={s.id}>
              <td title={`${s.username}@${s.host}`}>{s.name}</td>
              <td className={`mcp-acc-${r.access}`}>{r.accessLabel}</td>
              <td>{r.can}</td>
              <td>{r.protectedUsers.length ? r.protectedUsers.join(", ") : <span className="faint">—</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
