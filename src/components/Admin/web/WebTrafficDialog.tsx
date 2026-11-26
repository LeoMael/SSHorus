// Diálogo «Tráfico y visitas» de un sitio web (Caddy o nginx).
// Consulta 100 % bajo demanda (sin refresco automático) ejecutada con prioridad mínima en el servidor.
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, FileMinus2, FilePlus2, KeyRound, RefreshCw, Terminal } from "lucide-react";
import { errorMessage } from "../../../api/core";
import { formatBytes } from "../../../lib/format";
import {
  isSshorusLog,
  siteLogPlan,
  parseTraffic,
  trafficScript,
  type LogAction,
  type ServerInfo,
  type Site,
  type TrafficRange,
  type TrafficReport,
} from "../../../features/admin";
import { AdmModal } from "../../ui/AdmModal";
import { WebLogDialog } from "./WebLogDialog";
import { Segmented, type SegOption } from "../../ui/Segmented";
import { useAdmin } from "../context";
import { WebTrafficChart } from "./WebTrafficChart";
import { WebTrafficTables, type TrafficSubTab } from "./WebTrafficTables";
import "./WebTraffic.css";
import { readElevated } from "../../../features/privileges";

const RANGE_OPTIONS: SegOption<TrafficRange>[] = [
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
];

interface Props {
  server: ServerInfo;
  site: Site;
  onClose: () => void;
  /** Tras poner o quitar el registro en el servidor, recarga Sitios web para detectar la nueva ruta. */
  onLogChanged: () => void;
}

export function WebTrafficDialog({ server, site, onClose, onLogChanged }: Props) {
  const { sessionId, elevation, elev, askSudo, disabled } = useAdmin();
  const staticId = useId();
  const botsId = useId();
  const [range, setRange] = useState<TrafficRange>("24h");
  const [excludeStatic, setExcludeStatic] = useState(true);
  const [excludeBots, setExcludeBots] = useState(true);
  const [useJournal, setUseJournal] = useState(false);
  const [subtab, setSubtab] = useState<TrafficSubTab>("paths");
  const [logDialog, setLogDialog] = useState<LogAction | null>(null);
  const [state, setState] = useState<{ busy: boolean; report: TrafficReport | null; error: string | null; elevated: boolean }>({
    busy: false,
    report: null,
    error: null,
    elevated: false,
  });

  const log = site.accessLog ?? null;
  const hasSource = !!log?.path || log?.format === "journal" || useJournal;
  const title = site.names[0] ?? (site.server === "caddy" ? "Cualquier dominio" : "Sitio por defecto");
  const setup = useMemo(() => siteLogPlan(server, site, "enable"), [server, site]);
  const removal = useMemo(() => (isSshorusLog(site) ? siteLogPlan(server, site, "disable") : null), [server, site]);
  const logPlan = logDialog === "enable" ? setup : logDialog === "disable" ? removal : null;
  const openLog = (a: LogAction) => (elevation ? setLogDialog(a) : askSudo());

  const load = useCallback(async () => {
    if (!hasSource || disabled) return;
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const script = trafficScript(site, { range, excludeStatic, excludeBots, useJournal });
      const r = await readElevated(sessionId, script, elevation, 30);
      const report = parseTraffic(r.result.stdout, !!log?.shared && !useJournal);
      setState({ busy: false, report, error: null, elevated: r.elevated });
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: errorMessage(e) }));
    }
  }, [hasSource, disabled, site, range, excludeStatic, excludeBots, useJournal, sessionId, elevation, log?.shared]);

  useEffect(() => {
    if (hasSource) void load();
  }, [hasSource, load]);

  const report = state.report;
  const totalErr = report ? report.status.s4xx + report.status.s5xx : 0;
  const errPct = report && report.totalRequests > 0 ? ((totalErr / report.totalRequests) * 100).toFixed(1) : "0.0";
  const statusSum = report ? report.status.s2xx + report.status.s3xx + report.status.s4xx + report.status.s5xx : 0;
  const needSudoNote = !!report?.meta.note?.includes("Sin permiso") && !elevation && elev.canAskSudo;

  const subtabOptions: SegOption<TrafficSubTab>[] = report
    ? [
        { value: "paths", label: `Rutas (${report.topPaths.length})` },
        { value: "ips", label: `IPs (${report.topIps.length})` },
        { value: "refs", label: `Orígenes (${report.topReferrers.length})` },
        { value: "recent", label: `Últimas (${report.recent.length})` },
      ]
    : [];

  return (
    <>
      <AdmModal title={`Tráfico y visitas · ${title}`} onClose={onClose} width="min(880px, 94vw)">
        <div className="modal-body wt-body">
          {!hasSource ? (
            <div className="wt-empty-box">
              <h3>
                <BarChart3 size={17} aria-hidden="true" /> Este sitio no tiene registro de visitas activado
              </h3>
              <p>
                {site.server === "caddy"
                  ? "Caddy desactiva los registros de acceso por defecto para ahorrar disco. Puedes activar un registro dedicado con rotación automática (máx. 5 archivos de 10 MB, 30 días) sin cortar conexiones."
                  : "Este bloque de nginx tiene «access_log off;» o usa un destino no legible como archivo. Puedes activar un registro dedicado en /var/log/nginx/ sin cortar conexiones."}
              </p>
              <div className="wt-actions-row">
                {setup ? (
                  <button
                    className="btn btn-primary"
                    disabled={disabled || (!elevation && !elev.canAskSudo)}
                    onClick={() => openLog("enable")}
                    title={!elevation ? "Necesitas permisos de administrador (sudo) para editar la configuración" : undefined}
                  >
                    {elevation ? <FilePlus2 size={14} /> : <KeyRound size={14} />}
                    {elevation ? "Activar registro de visitas…" : "Conectar con sudo para activar"}
                  </button>
                ) : (
                  <span className="faint">
                    No se puede activar automáticamente (falta {site.server === "caddy" ? "un dominio explícito" : "la ruta del archivo de configuración"}).
                  </span>
                )}
                {site.server === "caddy" && (
                  <button className="btn" disabled={disabled} onClick={() => setUseJournal(true)}>
                    <Terminal size={14} /> Intentar leer desde journalctl
                  </button>
                )}
              </div>
              {setup && (
                <div className="faint">
                  Archivo propuesto: <code className="mono">{setup.logPath}</code> (antes de aplicar se guarda copia y se valida la configuración).
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="wt-toolbar">
                <Segmented label="Periodo de análisis" value={range} options={RANGE_OPTIONS} onChange={setRange} />
                <label className="wt-filter" htmlFor={staticId}>
                  <input id={staticId} type="checkbox" checked={excludeStatic} onChange={(e) => setExcludeStatic(e.target.checked)} />
                  Sin estáticos
                </label>
                <label className="wt-filter" htmlFor={botsId}>
                  <input id={botsId} type="checkbox" checked={excludeBots} onChange={(e) => setExcludeBots(e.target.checked)} />
                  Sin bots
                </label>
                <span className="adm-spacer" />
                <span className="wt-pill" title="No consulta en segundo plano: solo lee al abrir o pulsar Actualizar, con nice 19, ionice y tope de 8 MB.">
                  Bajo demanda · baja prioridad
                </span>
                <button className="btn btn-sm" onClick={() => void load()} disabled={state.busy || disabled}>
                  <RefreshCw size={13} /> Actualizar
                </button>
              </div>

              {report?.meta.sharedLog && (
                <div className="adm-note adm-note-warn adm-web-warn">
                  <AlertTriangle size={13} aria-hidden="true" />
                  <span>
                    {report.meta.hostFiltered
                      ? "Este registro lo comparten varios sitios, pero los datos se han filtrado por el dominio de este sitio."
                      : "Este registro lo comparten varios sitios (el formato estándar de nginx no guarda el dominio por línea): las cifras incluyen todo el servidor."}
                  </span>
                  {setup && (
                    <button className="btn btn-sm" onClick={() => openLog("enable")} disabled={disabled}>
                      <FilePlus2 size={13} /> Crear log propio…
                    </button>
                  )}
                </div>
              )}

              {(log?.format === "journal" || useJournal) && !log?.path && (
                <div className="adm-note adm-web-warn">
                  <Terminal size={13} aria-hidden="true" />
                  <span>Leyendo desde el diario de systemd (<code>journalctl -u caddy</code>). Puedes guardar un archivo dedicado con rotación.</span>
                  {setup && (
                    <button className="btn btn-sm" onClick={() => openLog("enable")} disabled={disabled}>
                      <FilePlus2 size={13} /> Guardar en archivo…
                    </button>
                  )}
                </div>
              )}

              {state.error && (
                <div className="adm-error" role="alert">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <pre>{state.error}</pre>
                </div>
              )}

              {state.busy && !report && (
                <div className="adm-loading" role="progressbar" aria-label="Analizando registro de visitas">
                  <span className="spinner" aria-hidden="true" /> Analizando registro en el servidor…
                </div>
              )}

              {report?.meta.note && (
                <div className="adm-note adm-note-warn adm-web-warn">
                  <AlertTriangle size={13} aria-hidden="true" />
                  <span>{report.meta.note}</span>
                  {needSudoNote && (
                    <button className="btn btn-sm" onClick={askSudo}>
                      <KeyRound size={13} /> Leer con sudo
                    </button>
                  )}
                </div>
              )}

              {report && (
                <>
                  <div className="wt-kpis">
                    <div className="wt-kpi">
                      <span className="wt-kpi-label">Peticiones / vistas</span>
                      <span className="wt-kpi-val">{report.totalRequests.toLocaleString("es-ES")}</span>
                      <span className="wt-kpi-sub">
                        {report.staticSkipped + report.botSkipped > 0
                          ? `Filtrados: ${report.staticSkipped} estáticos · ${report.botSkipped} bots`
                          : "Sin filtros excluidos"}
                      </span>
                    </div>
                    <div className="wt-kpi">
                      <span className="wt-kpi-label">Visitantes aprox. (IPs)</span>
                      <span className="wt-kpi-val">{report.uniqueIps.toLocaleString("es-ES")}</span>
                      <span className="wt-kpi-sub">Direcciones únicas en el periodo</span>
                    </div>
                    <div className="wt-kpi">
                      <span className="wt-kpi-label">Datos transferidos</span>
                      <span className="wt-kpi-val">{formatBytes(report.totalBytes)}</span>
                      <span className="wt-kpi-sub">Suma de respuestas contabilizadas</span>
                    </div>
                    <div className="wt-kpi">
                      <span className="wt-kpi-label">Errores (4xx / 5xx)</span>
                      <span className="wt-kpi-val">{totalErr.toLocaleString("es-ES")}</span>
                      <span className="wt-kpi-sub">{errPct} % del total</span>
                    </div>
                  </div>

                  {statusSum > 0 && (
                    <div className="wt-status-box">
                      <div className="wt-status-bar" aria-hidden="true">
                        {report.status.s2xx > 0 && <div className="wt-seg-2xx" style={{ flex: report.status.s2xx }} />}
                        {report.status.s3xx > 0 && <div className="wt-seg-3xx" style={{ flex: report.status.s3xx }} />}
                        {report.status.s4xx > 0 && <div className="wt-seg-4xx" style={{ flex: report.status.s4xx }} />}
                        {report.status.s5xx > 0 && <div className="wt-seg-5xx" style={{ flex: report.status.s5xx }} />}
                      </div>
                      <div className="wt-status-legend">
                        <span><span className="wt-dot wt-seg-2xx" aria-hidden="true" />2xx OK: {report.status.s2xx.toLocaleString("es-ES")}</span>
                        <span><span className="wt-dot wt-seg-3xx" aria-hidden="true" />3xx Redirección: {report.status.s3xx.toLocaleString("es-ES")}</span>
                        <span><span className="wt-dot wt-seg-4xx" aria-hidden="true" />4xx Cliente: {report.status.s4xx.toLocaleString("es-ES")}</span>
                        <span><span className="wt-dot wt-seg-5xx" aria-hidden="true" />5xx Servidor: {report.status.s5xx.toLocaleString("es-ES")}</span>
                      </div>
                    </div>
                  )}

                  <WebTrafficChart buckets={report.buckets} range={report.range} />

                  <Segmented label="Detalle de tráfico" value={subtab} options={subtabOptions} onChange={setSubtab} />
                  <WebTrafficTables report={report} tab={subtab} />

                  <div className="wt-meta">
                    <span className="mono">{report.meta.source}</span>
                    <span>·</span>
                    <span>
                      Leídos {formatBytes(report.meta.scannedBytes)}
                      {report.meta.fileSize > 0 ? ` de ${formatBytes(report.meta.fileSize)}` : ""}
                      {" "}({report.meta.linesRead.toLocaleString("es-ES")} líneas)
                      {report.meta.rotatedFiles > 0 &&
                        ` · con ${report.meta.rotatedFiles} ${report.meta.rotatedFiles === 1 ? "archivo rotado" : "archivos rotados"}`}
                    </span>
                    {report.meta.truncated && (
                      <>
                        <span>·</span>
                        <span>Tope de 8 MB alcanzado (muestra lo más reciente para proteger la CPU)</span>
                      </>
                    )}
                    {state.busy && <span className="spinner adm-spinner-btn" aria-hidden="true" />}
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          {removal && (
            <button
              className="btn adm-footer-left"
              onClick={() => openLog("disable")}
              disabled={disabled}
              title="Quita del sitio el registro que puso SSHorus (el archivo se conserva)"
            >
              <FileMinus2 size={14} /> Quitar registro…
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </AdmModal>

      {logPlan && (
        <WebLogDialog
          server={server}
          site={site}
          plan={logPlan}
          onClose={() => setLogDialog(null)}
          onChanged={() => {
            setUseJournal(false);
            onLogChanged();
          }}
        />
      )}
    </>
  );
}
