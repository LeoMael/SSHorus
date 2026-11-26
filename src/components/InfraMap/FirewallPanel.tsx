// Cortafuegos en el panel de detalles del mapa: estado, avisos al cruzarlo con los puertos en escucha,
// políticas, reglas en palabras simples y cambios seguros (firewalld y ufw; nftables/iptables solo se ven).
import { lazy, Suspense, useEffect, useState } from "react";
import { AlertTriangle, KeyRound, Plus, Power, RefreshCw, Timer } from "lucide-react";
import type { ServerSnapshot, FwRule } from "../../features/infra";
import { canManage } from "../../features/infra/firewall/report";
import { crossCheck } from "../../features/infra/firewall/crosscheck";
import { expireTrials, trialActions, useFwTrials } from "../../features/infra/firewall/job";
import { lockoutProblem } from "../../features/infra/firewall/lockout";
import { MANAGED_TEXT, policyLines, statusText } from "../../features/infra/firewall/explain";
import { FirewallChangeDialog, type ChangeRequest } from "./FirewallChangeDialog";
import { FirewallRules, type RuleActions } from "./FirewallRules";
import { useFirewall } from "./useFirewall";
import "./Firewall.css";

const SudoDialog = lazy(() => import("../Sudo/SudoDialog").then((m) => ({ default: m.SudoDialog })));

/** Cambios a prueba de esta conexión, con su cuenta atrás y los botones para resolverlos. */
function PendingTrials({ sessionId }: { sessionId: string }) {
  const all = useFwTrials((s) => s.trials);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
      expireTrials();
    }, 5000);
    return () => window.clearInterval(t);
  }, []);
  const mine = all.filter((t) => t.sessionId === sessionId && t.until > now);
  if (mine.length === 0) return null;
  return (
    <div className="fw-trials" role="status">
      {mine.map((t) => (
        <div key={t.tag} className="fw-trial">
          <Timer size={14} />
          <div className="fw-trial-text">
            <strong>{t.plan.title}</strong>
            <span>A prueba: se deshace solo en {Math.max(1, Math.ceil((t.until - now) / 60000))} min si no lo confirmas.</span>
          </div>
          {trialActions(t).map((a) => (
            <button key={a.label} className={a.primary ? "btn btn-sm btn-primary" : "btn btn-sm"} onClick={a.run}>
              {a.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function FirewallPanel({ snap }: { snap: ServerSnapshot }) {
  const { data, loading, error, reload, elev, info, sessionId, profileId } = useFirewall(snap);
  const [change, setChange] = useState<ChangeRequest | null>(null);
  const [sudoOpen, setSudoOpen] = useState(false);

  if (!sessionId) return <p className="faint fw-note">Sin conexión: conecta el servidor para ver las reglas de su cortafuegos.</p>;

  const report = data?.report ?? null;
  const guard = data?.guard ?? null;
  const manage = !!report && canManage(report) && !!elev.elevation;
  const findings = report ? crossCheck(report, snap.ports?.ports ?? null) : [];
  const policies = report ? policyLines(report) : [];
  const actions: RuleActions | null =
    manage && report && guard
      ? {
          removeBlock: (r: FwRule) => (r.ref && !r.managedBy ? lockoutProblem(report, { kind: "remove", rule: r }, guard) : undefined),
          onRemove: (r: FwRule) => setChange({ kind: "remove", rule: r }),
        }
      : null;

  return (
    <section className="fw-panel" aria-label="Reglas del cortafuegos" aria-busy={loading}>
      <div className="fw-head">
        <strong>{report ? statusText(report) : "Cortafuegos"}</strong>
        <button className="icon-btn" onClick={() => void reload()} disabled={loading} title="Volver a leer las reglas" aria-label="Volver a leer las reglas">
          <RefreshCw size={13} className={loading ? "adm-spin" : undefined} />
        </button>
      </div>
      {loading && !report && (
        <div className="faint fw-note" role="status">
          <span className="spinner adm-spinner-btn" /> Leyendo las reglas…
        </div>
      )}
      {error && (
        <div className="adm-error" role="alert">
          <AlertTriangle size={14} />
          <pre>{error}</pre>
        </div>
      )}
      {data?.sudoError && <div className="field-error">{data.sudoError}</div>}
      {report && !report.readable && (
        <div className="fw-note">
          Para ver las reglas hace falta sudo: sin él solo se sabe qué cortafuegos hay.
          {elev.canAskSudo && (
            <button className="btn btn-sm" onClick={() => setSudoOpen(true)}>
              <KeyRound size={13} /> Escribir la contraseña de sudo
            </button>
          )}
        </div>
      )}
      <PendingTrials sessionId={sessionId} />
      {findings.length > 0 && (
        <ul className="fw-findings" aria-label="Avisos">
          {findings.map((f) => (
            <li key={`${f.kind}${f.port}${f.proto}`} className={`fw-finding fw-f-${f.kind}`}>
              <AlertTriangle size={13} /> {f.text}
            </li>
          ))}
        </ul>
      )}
      {policies.length > 0 && (
        <ul className="fw-policy" aria-label="Lo que no encaja en ninguna regla">
          {policies.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {report?.readable && (report.tool === "nftables" || report.tool === "iptables") && (
        <p className="fw-note">Por ahora SSHorus solo enseña las reglas de {report.tool}: para cambiarlas, usa la terminal.</p>
      )}
      {manage && report && (
        <div className="im-details-actions">
          {report.active ? (
            <button className="btn btn-sm" onClick={() => setChange({ kind: "add" })}>
              <Plus size={13} /> Abrir puerto o servicio…
            </button>
          ) : (
            <button className="btn btn-sm" onClick={() => setChange({ kind: "enable" })}>
              <Power size={13} /> Activar {report.tool}…
            </button>
          )}
        </div>
      )}
      {report && report.rules.length > 0 && <FirewallRules rules={report.rules} report={report} actions={actions} />}
      {report?.readable && report.active && report.rules.length === 0 && <p className="faint fw-note">No hay reglas propias.</p>}
      {report && report.managed.length > 0 && (
        <details className="fw-managed">
          <summary>Creadas por Docker/Podman ({report.managed.length})</summary>
          <p className="faint">{MANAGED_TEXT}</p>
          <FirewallRules rules={report.managed} report={report} actions={null} />
        </details>
      )}
      {change && report && guard && (
        <FirewallChangeDialog
          request={change}
          report={report}
          guard={guard}
          sessionId={sessionId}
          profileId={profileId}
          serverName={snap.name}
          elevation={elev.elevation}
          onClose={() => setChange(null)}
        />
      )}
      {sudoOpen && (
        <Suspense fallback={null}>
          <SudoDialog sessionId={sessionId} profileId={profileId} user={info?.user ?? null} onClose={() => setSudoOpen(false)} />
        </Suspense>
      )}
    </section>
  );
}
