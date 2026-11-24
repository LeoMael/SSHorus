// Sub-pestaña «Vulnerabilidades»: qué software tiene el servidor y qué vulnerabilidades conocidas le
// afectan. Columnas, filtros e iconos de fase en VulnsTable.tsx.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, CircleSlash, Eye, FileDown, History, KeyRound, Play, RotateCcw, Settings2, ShieldAlert, Square, Users } from "lucide-react";
import { errorMessage } from "../../api/core";
import { ai, vulnscan, type Report, type Severity } from "../../api/vulnscan";
import { cancelScan, fixKind, loadStoreUsers, startScan, useVulnNav, useVulnScan, type FixKind } from "../../features/vulnscan";
import { useLock } from "../../features/lock/lockStore";
import { storedFailed, sudoModeOf, useStoredSudoState } from "../../features/privileges";
import { useSettings } from "../../stores/settings";
import { toast } from "../../stores/toasts";
import { useAdmin } from "./context";
import { VirtualTable } from "./VirtualTable";
import { VulnSummary, diffReports, type ScanDiff } from "./VulnSummary";
import { VulnDetail } from "./VulnDetail";
import { AiAnswer, AiExplainDialog } from "./AiExplainDialog";
import { ExportDialog, HistoryDialog, OptionsDialog, OsvSampleDialog, UsersDialog } from "./VulnsDialogs";
import { SEV_ORDER, sudoToolOf } from "./vulnUi";
import { VulnFixBar } from "./VulnFixBar";
import { FixDialog } from "./FixDialog";
import { useVulnFix } from "./useVulnFix";
import { buildVulnColumns, matchesVuln, PhaseIcon, vulnRowKey, VulnsFilterBar, type VulnRow } from "./VulnsTable";
import "./Vulns.css";

export function VulnsTab() {
  const { sessionId, profileId, serverName, disabled, elevation, elev, info, askSudo } = useAdmin();
  const run = useVulnScan((s) => s.runs[sessionId]);
  const report = useVulnScan((s) => s.reports[sessionId]);
  const setReport = useVulnScan((s) => s.setReport);
  const clearReport = useVulnScan((s) => s.clearReport);
  const users = useVulnScan((s) => s.users[sessionId] ?? null);
  const vs = useSettings((s) => s.settings.vulnscan);
  const aiSettings = useSettings((s) => s.settings.ai);
  const locked = useLock((s) => !!s.status?.locked);
  const running = !!run?.running;
  const storedSudo = useStoredSudoState(sessionId);
  const sudoBad = !elevation && (!!run?.sudoRejected || storedFailed(storedSudo));

  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [origin, setOrigin] = useState("all");
  const [onlyFix, setOnlyFix] = useState(false);
  const [fixFilter, setFixFilter] = useState<FixKind | null>(null);
  const fix = useVulnFix(sessionId, report);
  const [showUnimportant, setShowUnimportant] = useState(false);
  const [query, setQuery] = useState("");
  const [kernelOpen, setKernelOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "osv" | "history" | "export" | "users" | "options" | "ai">(null);
  const [diff, setDiff] = useState<ScanDiff | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    if (report !== undefined) return;
    let alive = true;
    vulnscan.latest(profileId).then(
      (r) => alive && setReport(sessionId, r),
      () => alive && setReport(sessionId, null),
    );
    return () => {
      alive = false;
    };
  }, [report, profileId, sessionId, setReport]);

  useEffect(() => {
    setDiff(null);
    if (!report) return;
    let alive = true;
    (async () => {
      const list = await vulnscan.historyList(profileId);
      const i = list.findIndex((m) => m.id === report.id);
      const prev = i >= 0 ? list[i + 1] : undefined;
      if (!prev) return;
      const old = await vulnscan.historyGet(profileId, prev.id);
      if (alive) setDiff(diffReports(report, old));
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [report, profileId]);

  const nav = useVulnNav((s) => s.request);
  const navDone = useVulnNav((s) => s.done);
  useEffect(() => {
    if (!nav || nav.sessionId !== sessionId) return;
    setPendingImage({ id: nav.imageId, label: nav.label });
    navDone(nav.seq);
  }, [nav, sessionId, navDone]);
  useEffect(() => {
    if (!pendingImage || report === undefined) return;
    const t = report?.targets.find((x) => x.kind === "image" && x.image?.id.startsWith(pendingImage.id));
    if (t) {
      setOrigin(t.key);
      setSeverity("all");
      setQuery("");
    } else {
      toast.info(
        `«${pendingImage.label}» no está en el último análisis`,
        report ? "Pulsa «Analizar» para incluirla (o revisa el límite de imágenes en las opciones)." : "Pulsa «Analizar».",
      );
    }
    setPendingImage(null);
  }, [pendingImage, report]);

  const all = useMemo(() => report?.findings ?? [], [report]);
  const unimportantCount = useMemo(() => all.filter((f) => f.unimportant).length, [all]);
  const filtered = useMemo(
    () =>
      all.filter(
        (f) =>
          (showUnimportant || !f.unimportant) &&
          (severity === "all" || f.severity === severity) &&
          (origin === "all" || f.target === origin) &&
          (!onlyFix || f.hasFix) &&
          (!fixFilter || (!!report && fixKind(report, f) === fixFilter)) &&
          matchesVuln(f, query.trim()),
      ),
    [all, report, showUnimportant, severity, origin, onlyFix, fixFilter, query],
  );
  const rows = useMemo<VulnRow[]>(() => {
    const kernel = filtered.filter((f) => f.kernel && f.target === "system");
    const rest = filtered.filter((f) => !(f.kernel && f.target === "system"));
    const out: VulnRow[] = [];
    if (kernel.length) {
      const worst = SEV_ORDER.find((s) => kernel.some((k) => k.severity === s)) ?? "unknown";
      out.push({ kind: "kernel", items: kernel, worst, open: kernelOpen });
      if (kernelOpen) for (const f of kernel) out.push({ kind: "f", f, child: true });
    }
    for (const f of rest) out.push({ kind: "f", f, child: false });
    return out;
  }, [filtered, kernelOpen]);

  const selRow = rows.find((r) => vulnRowKey(r) === selected) ?? null;
  const tool = sudoToolOf(info, elevation);

  const analyze = useCallback(async () => {
    const r = await startScan({ sessionId, profileId, elevation, settings: useSettings.getState().settings.vulnscan });
    if (r) {
      setSelected(null);
      toast.success("Análisis terminado", `${r.summary.total} vulnerabilidades (${r.summary.withFix} con arreglo)`);
    } else {
      const st = useVulnScan.getState().runs[sessionId];
      if (st?.error) toast.error("El análisis no pudo terminar", st.error);
    }
  }, [sessionId, profileId, elevation]);

  const loadUsers = useCallback(async () => {
    if (!elevation) return;
    setUsersLoading(true);
    setUsersError(null);
    try {
      await loadStoreUsers(sessionId, elevation);
    } catch (e) {
      setUsersError(errorMessage(e));
    } finally {
      setUsersLoading(false);
    }
  }, [sessionId, elevation]);

  const openUsers = () => {
    setDialog("users");
    if (!users) void loadUsers();
  };

  const chosen = vs.usersByServer[profileId] ?? [];
  const [aiLocked, setAiLocked] = useState(false);
  useEffect(() => {
    if (!aiSettings.enabled) return;
    ai.status().then(
      (s) => setAiLocked(s.locked),
      () => {},
    );
  }, [aiSettings.enabled, locked]);

  const toggleKernel = () => setKernelOpen((o) => !o);
  const columns = buildVulnColumns(report, toggleKernel);
  const statusSources = report?.sources ?? [];
  const aiBlock = !aiSettings.enabled
    ? null
    : locked || aiLocked
      ? "Desbloquea SSHorus para usar la IA"
      : !report
        ? "Primero analiza el servidor"
        : !aiSettings.baseUrl || !aiSettings.model
          ? "Falta la URL o el modelo (Ajustes → IA para explicar informes)"
          : null;

  return (
    <div className="adm-pane vs-root">
      {sudoBad && !disabled && (
        <div className="adm-banner adm-banner-warn" role="alert">
          <ShieldAlert size={14} />
          <span className="adm-banner-text">
            {storedFailed(storedSudo)
              ? sudoModeOf(profileId) === "login"
                ? "La contraseña de la conexión no sirve para sudo."
                : "La contraseña de sudo guardada no funcionó."
              : "sudo rechazó la contraseña."}{" "}
            {run?.sudoRejected ? "El análisis siguió sin sudo: no se ven los contenedores de otros usuarios ni los de root." : ""}
          </span>
          {elev.canAskSudo && (
            <button className="btn btn-sm" onClick={askSudo}>
              <KeyRound size={13} /> Escribir otra contraseña
            </button>
          )}
        </div>
      )}
      {!elevation && !disabled && !sudoBad && (
        <div className="adm-banner adm-banner-warn" role="status">
          <ShieldAlert size={14} />
          <span className="adm-banner-text">
            Sin sudo se analizan el sistema y tus contenedores; no se ven los contenedores de otros usuarios ni los de root.
          </span>
          {elev.canAskSudo && (
            <button className="btn btn-sm" onClick={askSudo}>
              <KeyRound size={13} /> Analizar con sudo
            </button>
          )}
        </div>
      )}
      <div className="adm-toolbar">
        {running ? (
          <button className="btn btn-sm" onClick={() => void cancelScan(sessionId)}>
            <Square size={13} /> Cancelar
          </button>
        ) : (
          <button
            className="btn btn-sm btn-primary"
            onClick={() => void analyze()}
            disabled={disabled || !!fix.checking}
            title={disabled ? "Sin conexión con el servidor" : "Analiza el servidor (solo lectura)"}
          >
            <Play size={13} /> Analizar
          </button>
        )}
        <span className="vs-sources" aria-label="Fuentes">
          {(statusSources.length
            ? statusSources
            : [
                { id: "osv" as const, label: "OSV.dev", used: vs.useOsv, note: vs.useOsv ? null : "desactivado" },
                { id: "distro" as const, label: "Distro", used: vs.useDistroTool, note: null },
                { id: "trivy" as const, label: "Trivy", used: false, note: "se sabrá al analizar" },
              ]
          ).map((s) => (
            <span key={s.id} className={`vs-src${s.used ? " on" : ""}`} title={`${s.label}${s.note ? `: ${s.note}` : s.used ? ": usado" : ""}`}>
              {s.used ? <Check size={11} /> : <CircleSlash size={11} />} {s.id === "osv" ? "OSV" : s.id === "trivy" ? s.label : "Distro"}
            </span>
          ))}
        </span>
        {elevation && (
          <button className="btn btn-sm" onClick={openUsers} disabled={running || disabled} title="De qué usuarios se miran los contenedores">
            <Users size={13} /> Usuarios: {chosen.length ? chosen.length : "Todos"}
          </button>
        )}
        <span className="adm-spacer" />
        {aiSettings.enabled && (
          <button className="btn btn-sm" onClick={() => setDialog("ai")} disabled={!!aiBlock || running} title={aiBlock ?? "Pide a la IA que explique este informe"}>
            <Bot size={13} /> Explicar con IA
          </button>
        )}
        <button className="btn btn-sm" onClick={() => setDialog("export")} disabled={!report} title="Exportar a JSON o Markdown">
          <FileDown size={13} /> Exportar
        </button>
        <button className="icon-btn" onClick={() => setDialog("history")} title="Historial de análisis" aria-label="Historial de análisis">
          <History size={14} />
        </button>
        <button className="icon-btn" onClick={() => setDialog("options")} title="Opciones del análisis" aria-label="Opciones del análisis">
          <Settings2 size={14} />
        </button>
      </div>
      <div className="vs-privacy">
        A OSV.dev solo se envían nombres y versiones de paquetes. Nunca la IP ni el nombre del servidor.{" "}
        <button className="vs-link" onClick={() => setDialog("osv")}>
          <Eye size={11} /> ver qué se envía
        </button>
      </div>

      {run && (running || run.error || run.canceled) && (
        <div className="vs-phases" role="status" aria-live="polite">
          <ul>
            {run.phases.map((p) => (
              <li key={p.id} className={`vs-ph vs-ph-${p.status}`}>
                <PhaseIcon p={p} />
                <span>{p.label}</span>
                {p.detail && <span className="faint">· {p.detail}</span>}
              </li>
            ))}
          </ul>
          <div className="vs-ph-progress">{running ? run.progress : run.canceled ? "Análisis cancelado." : `No se pudo terminar: ${run.error}`}</div>
        </div>
      )}

      {report === undefined ? (
        <div className="empty-state">
          <span className="spinner" />
        </div>
      ) : !report ? (
        !running && (
          <div className="empty-state">
            <ShieldAlert size={22} />
            <div>Todavía no se ha analizado este servidor</div>
            <div className="faint adm-pre-wrap">
              «Analizar» lista el software instalado (paquetes, kernel, programas sueltos e imágenes de contenedores) y busca
              sus vulnerabilidades conocidas en OSV.dev y en la herramienta de seguridad de la distro. Es solo lectura.
            </div>
          </div>
        )
      ) : (
        <>
          <VulnSummary report={report} diff={diff} severity={severity} onSeverity={setSeverity} />
          <VulnFixBar
            report={report}
            sessionId={sessionId}
            filter={fixFilter}
            onFilter={setFixFilter}
            onFixAll={() => fix.openFix(report.findings)}
            checking={fix.checking}
            onRecheck={() => void fix.recheck()}
            onCancelCheck={fix.cancelRecheck}
            disabled={disabled || running}
          />
          {report.ai && (
            <details className="vs-ai-details">
              <summary>
                <Bot size={13} /> Explicación de la IA
              </summary>
              <AiAnswer report={report} sessionId={sessionId} />
            </details>
          )}
          {report.notes.length > 0 && (
            <details className="vs-notes">
              <summary>Avisos del análisis ({report.notes.length})</summary>
              <ul>
                {report.notes.map((n, i) => (
                  <li key={i} className={`vs-note-${n.level}`}>
                    {n.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <VulnsFilterBar
            report={report}
            query={query}
            setQuery={setQuery}
            severity={severity}
            setSeverity={setSeverity}
            origin={origin}
            setOrigin={setOrigin}
            onlyFix={onlyFix}
            setOnlyFix={setOnlyFix}
            unimportantCount={unimportantCount}
            showUnimportant={showUnimportant}
            setShowUnimportant={setShowUnimportant}
          />
          <div className="vs-main">
            <VirtualTable
              label="Vulnerabilidades"
              columns={columns}
              rows={rows}
              rowKey={vulnRowKey}
              selected={selRow ? vulnRowKey(selRow) : null}
              onSelect={setSelected}
              onActivate={(r) => (r.kind === "kernel" ? toggleKernel() : setSelected(r.f.key))}
              rowClass={(r) => (r.kind === "kernel" ? "vs-row-kernel" : r.f.unimportant ? "adm-row-muted" : "")}
              placeholder={
                <div className="adm-empty-text">
                  {all.length === 0 ? "No se encontraron vulnerabilidades conocidas." : "Ninguna coincide con los filtros."}
                  {all.length > 0 && (query || severity !== "all" || origin !== "all" || onlyFix || fixFilter) && (
                    <div>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          setQuery("");
                          setSeverity("all");
                          setOrigin("all");
                          setOnlyFix(false);
                          setFixFilter(null);
                        }}
                      >
                        Quitar filtros
                      </button>
                    </div>
                  )}
                </div>
              }
            />
            {selRow && (
              <VulnDetail
                report={report}
                finding={selRow.kind === "f" ? selRow.f : null}
                kernel={selRow.kind === "kernel" ? selRow.items : null}
                sessionId={sessionId}
                tool={tool}
                onFix={running || disabled ? undefined : fix.openFix}
                onClose={() => setSelected(null)}
              />
            )}
          </div>
          <div className="adm-statusbar">
            {filtered.length} de {all.length - (showUnimportant ? 0 : unimportantCount)}
            <span className="faint">·</span>
            <span>{new Date(report.createdAt).toLocaleString("es")}</span>
            <span className="faint">·</span>
            <span>{report.host.os.prettyName || report.host.os.id}</span>
            <span className="faint">·</span>
            <span>{report.elevated ? "con sudo" : "sin sudo"}</span>
            <span className="adm-spacer" />
            {report.host.inContainer && (
              <span className="faint" title="El kernel es el del anfitrión">
                <RotateCcw size={11} /> contenedor
              </span>
            )}
          </div>
        </>
      )}

      {fix.fixScope && report && <FixDialog report={report} findings={fix.fixScope} onClose={fix.closeFix} />}
      {dialog === "osv" && <OsvSampleDialog report={report ?? null} onClose={() => setDialog(null)} />}
      {dialog === "history" && (
        <HistoryDialog
          profileId={profileId}
          currentId={report?.id ?? null}
          onOpen={(r: Report) => {
            setReport(sessionId, r);
            setSelected(null);
          }}
          onDeleted={(id) => {
            if (!id || id === report?.id) clearReport(sessionId);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "export" && report && <ExportDialog report={report} profileId={profileId} serverName={serverName} onClose={() => setDialog(null)} />}
      {dialog === "users" && (
        <UsersDialog profileId={profileId} users={users} loading={usersLoading} error={usersError} onReload={() => void loadUsers()} onClose={() => setDialog(null)} />
      )}
      {dialog === "options" && <OptionsDialog onClose={() => setDialog(null)} />}
      {dialog === "ai" && report && (
        <AiExplainDialog report={report} profileId={profileId} onDone={(r) => setReport(sessionId, r)} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
