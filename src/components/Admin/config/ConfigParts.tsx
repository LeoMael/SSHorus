// Piezas de una sección de «Configuración»: icono de estado, datos, filas (denegaciones, booleans,
// cárceles, sysctl…) con su botón o qué hacer, y los botones de cambio.
import { AlertTriangle, CheckCircle2, CircleDashed, Info, MinusCircle, Wrench, XCircle } from "lucide-react";
import type { ConfigChange, ConfigRow, ConfigStatus, Fact, RowGroup } from "../../../features/serverConfig";
import { CommandActions } from "../vulns/vulnUi";
import { useAdmin } from "../context";

const ICON: Record<ConfigStatus, typeof CheckCircle2> = { ok: CheckCircle2, warn: AlertTriangle, bad: XCircle, info: Info, skip: CircleDashed, na: MinusCircle };
export const STATUS_LABEL: Record<ConfigStatus, string> = { ok: "Bien", warn: "Aviso", bad: "Mal", info: "Dato", skip: "Sin leer", na: "No aplica" };

export function StatusIcon({ status, size = 14 }: { status: ConfigStatus; size?: number }) {
  const Icon = ICON[status];
  return <Icon size={size} className={`cf-icon cf-${status}`} aria-label={STATUS_LABEL[status]} />;
}

/** ¿Se puede pulsar un cambio? (sin sudo se abre igual el diálogo, que ofrece la contraseña) */
export function useCanChange(): { ok: boolean; why: string | null } {
  const { disabled, elevation, elev } = useAdmin();
  if (disabled) return { ok: false, why: "Sin conexión" };
  if (!elevation && !elev.canAskSudo) return { ok: false, why: "Necesitas root o sudo" };
  return { ok: true, why: null };
}

export function ChangeButton({ change, onChange }: { change: ConfigChange; onChange: (c: ConfigChange) => void }) {
  const can = useCanChange();
  return (
    <button
      className={change.danger ? "btn btn-sm btn-danger" : "btn btn-sm"}
      onClick={() => onChange(change)}
      disabled={!can.ok}
      title={can.why ?? (change.danger ? "Puede cortar el acceso: pide confirmación" : "Muestra el comando antes de ejecutarlo")}
    >
      <Wrench size={12} /> {change.label}
    </button>
  );
}

export function Facts({ facts }: { facts: Fact[] }) {
  if (!facts.length) return null;
  return (
    <dl className="cf-facts">
      {facts.map((f) => (
        <div key={f.label} className="cf-fact">
          <dt>{f.label}</dt>
          <dd>
            {f.status && <StatusIcon status={f.status} size={12} />} <span className="mono">{f.value}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Row({ r, onChange }: { r: ConfigRow; onChange: (c: ConfigChange) => void }) {
  const { sessionId } = useAdmin();
  return (
    <li className="cf-row">
      <div className="cf-row-head">
        <StatusIcon status={r.status} size={13} />
        <span className="cf-row-title mono">{r.title}</span>
        {r.change && <ChangeButton change={r.change} onChange={onChange} />}
      </div>
      {r.detail && <div className="cf-row-detail">{r.detail}</div>}
      {r.advice && <div className="cf-row-advice">Qué hacer: {r.advice}</div>}
      {r.copy && (
        <div className="cf-row-copy">
          <pre className="adm-cmd adm-cmd-sm">{r.copy}</pre>
          <div className="cf-actions">
            <CommandActions sessionId={sessionId} text={r.copy} />
          </div>
        </div>
      )}
    </li>
  );
}

export function Groups({ groups, onChange }: { groups: RowGroup[]; onChange: (c: ConfigChange) => void }) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.title} className="cf-group">
          <div className="section-label">{g.title}</div>
          {g.rows.length ? (
            <ul className="cf-rows">
              {g.rows.map((r) => (
                <Row key={r.id} r={r} onChange={onChange} />
              ))}
            </ul>
          ) : (
            <div className="faint cf-empty">{g.empty}</div>
          )}
        </div>
      ))}
    </>
  );
}
