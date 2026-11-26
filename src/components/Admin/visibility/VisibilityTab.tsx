// Sub-pestaña «Visibilidad» («Qué pueden ver tus usuarios»): muestra por cada usuario sin sudo qué
// recursos puede ver o alcanzar (túneles SSH, servicios en 127.0.0.1, /proc, carpetas HOME, config web,
// cron/logs y Docker/contenedores) y ofrece arreglar cada punto enseñando antes los comandos exactos.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, Eye, KeyRound, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { errorMessage } from "../../../api/core";
import {
  analyzeUserVisibility,
  buildVisibilityFixPlan,
  disableAllNonAdminTunnelsPlan,
  USER_VISIBILITY_SCRIPT,
  type Plan,
  type UserVisibilityReport,
  type VisibilityCheck,
  type VisibilityReport,
} from "../../../features/admin";
import { refreshPrivilege, sudoRejected, readElevated } from "../../../features/privileges";
import { gradeClass } from "../audit/AuditReportView";
import { useAdmin } from "../context";
import { PlanModal } from "../PlanReview";
import "../audit/Audit.css";
import "./Visibility.css";

interface PendingFix {
  title: string;
  plan: Plan;
  note?: string;
}

export function VisibilityTab() {
  const { sessionId, elevation, elev, env, disabled, readOnly, ports, loadPorts, askSudo } = useAdmin();
  const [report, setReport] = useState<VisibilityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState<PendingFix | null>(null);
  const gen = useRef(0);

  const load = useCallback(async () => {
    const g = ++gen.current;
    setLoading(true);
    setError(null);
    try {
      const r = await readElevated(sessionId, USER_VISIBILITY_SCRIPT, elevation, 45);
      if (g !== gen.current) return;
      if (r.elevationError?.failure === "need-password") refreshPrivilege(sessionId);
      if (r.elevationError?.failure === "bad-password") sudoRejected(sessionId);
      setReport(analyzeUserVisibility(r.result.stdout, ports.data, r.elevated));
    } catch (e) {
      if (g === gen.current) setError(errorMessage(e));
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [sessionId, elevation, ports.data]);

  useEffect(() => {
    if (!disabled) void load();
  }, [disabled, load]);

  const anyOpenTunnels = !!report?.users.some((u) => u.checks.some((c) => c.area === "tunnels" && c.status === "bad"));

  const openAreaFix = (u: UserVisibilityReport, c: VisibilityCheck) => {
    if (!report) return;
    const plan = buildVisibilityFixPlan(c.area, u, report, env);
    if (!plan) return;
    setFixing({
      title: `${c.title} (${u.user})`,
      plan,
      note:
        c.area === "tunnels"
          ? "Se añade un bloque Match User en /etc/ssh/sshd_config.d, se comprueba con sshd -t y se recarga sshd (si falla, se deshace)."
          : c.area === "processes"
            ? "Activa hidepid=2 en /proc inmediatamente y en /etc/fstab. Las herramientas de monitorización sin sudo dejarán de ver procesos ajenos."
            : undefined,
    });
  };

  const openGlobalTunnelsFix = () => {
    if (!report) return;
    setFixing({
      title: "Desactivar túneles SSH para usuarios sin sudo",
      plan: disableAllNonAdminTunnelsPlan(report.adminGroups),
      note: "Aplica AllowTcpForwarding no (y X11, sockets, PermitTunnel, GatewayPorts) a todos los usuarios que no son root ni administradores.",
    });
  };

  return (
    <div className="adm-pane vis-root">
      <div className="adm-toolbar">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => {
            loadPorts();
            void load();
          }}
          disabled={disabled || loading}
        >
          <RefreshCw size={13} className={loading ? "adm-spin" : undefined} /> Comprobar de nuevo
        </button>
        {!elevation && elev.canAskSudo && (
          <button type="button" className="btn btn-sm" onClick={askSudo} title="Con sudo se comprueban túneles SSH (sshd -T), sudoers y permisos reales">
            <KeyRound size={13} /> Con sudo…
          </button>
        )}
        <div className="adm-spacer" />
        {anyOpenTunnels && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={readOnly}
            title={readOnly ? "Necesitas root o sudo" : "Cierra túneles SSH a todos los usuarios sin sudo"}
            onClick={openGlobalTunnelsFix}
          >
            <Wrench size={13} /> Cerrar túneles a todos los sin sudo…
          </button>
        )}
      </div>

      {error && (
        <div className="adm-banner adm-banner-warn" role="alert">
          <AlertTriangle size={14} />
          <span className="adm-banner-text">{error}</span>
        </div>
      )}

      <div className="vis-scroll">
        {loading && !report ? (
          <div className="vis-loading" role="progressbar" aria-label="Comprobando qué pueden ver tus usuarios">
            <span className="spinner" />
            <span>Comprobando aislamiento de usuarios…</span>
          </div>
        ) : !report ? (
          <div className="empty-state">
            <Eye size={22} />
            <div>Comprueba qué pueden ver o alcanzar tus usuarios sin sudo.</div>
          </div>
        ) : (
          <>
            <div className="vis-summary">
              <div className={`au-grade ${gradeClass(report.grade)}`} aria-label={`Nota de aislamiento ${report.grade ?? "sin nota"}`}>
                {report.grade ?? "—"}
              </div>
              <div className="vis-summary-text">
                <div className="vis-summary-title">Qué pueden ver tus usuarios</div>
                <div>{report.summary}</div>
                <div className="faint">
                  {report.elevated ? "Leído con sudo" : "Leído sin sudo (algunos puntos como túneles SSH necesitan sudo)"} · Administradores excluidos:{" "}
                  {report.adminUsers.join(", ")}
                </div>
              </div>
            </div>

            {report.users.length === 0 ? (
              <div className="empty-state">
                <ShieldCheck size={22} />
                <div>No hay usuarios humanos sin sudo con shell interactiva.</div>
                <div className="faint">
                  {report.localServices.length > 0
                    ? `Hay ${report.localServices.length} servicio${report.localServices.length === 1 ? "" : "s"} escuchando en 127.0.0.1.`
                    : "Cuando crees cuentas para otras personas aparecerán aquí con su nota y arreglos."}
                </div>
              </div>
            ) : (
              <div className="vis-user-list">
                {report.users.map((u, idx) => (
                  <details key={u.user} className="vis-card" open={idx === 0 || u.exposedCount > 0}>
                    <summary>
                      <ChevronRight size={14} className="vis-chevron" aria-hidden="true" />
                      <span className="vis-user-name mono">{u.user}</span>
                      <span className="vis-user-meta">
                        UID {u.uid} · {u.home}
                      </span>
                      <span className="vis-user-spacer" />
                      {u.exposedCount > 0 && <span className="vis-pill vis-pill-bad">Puede ver {u.exposedCount}</span>}
                      {u.warnCount > 0 && <span className="vis-pill vis-pill-warn">Aviso {u.warnCount}</span>}
                      {u.okCount > 0 && <span className="vis-pill vis-pill-ok">Aislado {u.okCount}</span>}
                      <span className={`vis-grade-mini ${gradeClass(u.grade)}`} title={u.score !== null ? `Nota ${u.score}/100` : "Sin nota"}>
                        {u.grade ?? "—"}
                      </span>
                    </summary>
                    <div className="vis-body">
                      <table className="vis-table">
                        <caption className="vis-sr-only">Qué puede ver o alcanzar el usuario {u.user}</caption>
                        <thead>
                          <tr>
                            <th scope="col">Punto</th>
                            <th scope="col">Estado</th>
                            <th scope="col">Detalle</th>
                            <th scope="col">Acción</th>
                          </tr>
                        </thead>
                        <tbody>
                          {u.checks.map((c) => {
                            const canFix = c.fixable && buildVisibilityFixPlan(c.area, u, report, env) !== null;
                            return (
                              <tr key={c.area}>
                                <th scope="row">{c.title}</th>
                                <td>
                                  <span className={`vis-pill vis-pill-${c.status}`}>{c.verdict}</span>
                                </td>
                                <td>
                                  <div>{c.detail}</div>
                                  {c.items.length > 0 && (
                                    <ul className="vis-items">
                                      {c.items.map((item, i) => (
                                        <li key={i} className="mono">
                                          {item}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  {c.manualHint && <div className="vis-hint">{c.manualHint}</div>}
                                </td>
                                <td>
                                  {canFix ? (
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      disabled={readOnly}
                                      title={readOnly ? "Necesitas root o sudo" : `Revisar comandos para arreglar ${c.title.toLowerCase()}`}
                                      aria-label={`Arreglar ${c.title.toLowerCase()} para ${u.user}`}
                                      onClick={() => openAreaFix(u, c)}
                                    >
                                      <Wrench size={12} /> Arreglar
                                    </button>
                                  ) : (
                                    <span className="faint">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {fixing && (
        <PlanModal
          title={fixing.title}
          plan={fixing.plan}
          onCancel={() => setFixing(null)}
          onDone={() => {
            setFixing(null);
            void load();
          }}
          runLabel="Aplicar cambio"
        >
          {fixing.note && <p className="dialog-message">{fixing.note}</p>}
        </PlanModal>
      )}
    </div>
  );
}
