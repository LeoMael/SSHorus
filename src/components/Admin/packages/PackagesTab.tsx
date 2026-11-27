// Sub-pestaña «Paquetes»: qué hay para actualizar (y qué es de seguridad, cuando la distro lo dice),
// actualizar todo, solo lo de seguridad o un paquete, y buscar, instalar o quitar. Cada cambio enseña
// antes su comando exacto y corre como tarea en segundo plano (con su salida en vivo y «Cancelar»).
import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Download, KeyRound, Package, RefreshCw, ShieldAlert } from "lucide-react";
import {
  kernelUpdates,
  loadPackages,
  MANAGERS,
  PACKAGES_JOB,
  packagesCache,
  upgradeAllChange,
  upgradeSecurityChange,
  upgradeSomeChange,
  type Upgrade,
} from "../../../features/packages";
import type { ConfigChange } from "../../../features/serverConfig";
import { Segmented } from "../../ui/Segmented";
import { ConfigChangeDialog } from "../config/ConfigChangeDialog";
import { useAdmin } from "../context";
import { useTabRead } from "../useTabRead";
import { VirtualTable, type Column } from "../VirtualTable";
import { PackageSearch } from "./PackageSearch";
import "../audit/AuditFix.css";
import "../AdminOps.css";

type View = "updates" | "search";

export function PackagesTab({ onOpenServices }: { onOpenServices: () => void }) {
  const { sessionId, elevation, elev, disabled, askSudo } = useAdmin();
  const entry = packagesCache.useEntry(sessionId);
  const [view, setView] = useState<View>("updates");
  const [selected, setSelected] = useState<string | null>(null);
  const [change, setChange] = useState<ConfigChange | null>(null);
  const data = entry.data;
  const load = useCallback(() => void loadPackages(sessionId, elevation), [sessionId, elevation]);
  const refresh = () => void loadPackages(sessionId, elevation, true);
  useTabRead({ sessionId, jobKind: PACKAGES_JOB, hasData: !!data, elevatedData: !!data?.elevated, disabled, elevation, load });

  const updates = useMemo(() => data?.updates ?? [], [data]);
  const kernels = kernelUpdates(updates);
  const m = data?.manager ?? "none";
  const sec = data ? upgradeSecurityChange(data) : null;
  const secCount = data?.securityCount ?? null;

  const columns: Column<Upgrade>[] = [
    {
      key: "name",
      label: "Paquete",
      width: "minmax(160px, 1.2fr)",
      render: (u) => (
        <span className="adm-name">
          {u.name}
          {u.security && <span className="adm-tag adm-tag-red">Seguridad</span>}
        </span>
      ),
      title: (u) => `${u.name}${u.arch ? `.${u.arch}` : ""}`,
    },
    { key: "cur", label: "Instalada", width: "minmax(110px, 1fr)", render: (u) => <span className="svc-mono faint">{u.current ?? "—"}</span>, title: (u) => u.current ?? "" },
    { key: "new", label: "Nueva", width: "minmax(110px, 1fr)", render: (u) => <span className="svc-mono">{u.version}</span>, title: (u) => u.version },
    { key: "repo", label: "Repositorio", width: "minmax(100px, 0.8fr)", render: (u) => <span className="faint">{u.repo ?? "—"}</span>, title: (u) => u.repo ?? "" },
    {
      key: "act",
      label: "",
      width: "110px",
      render: (u) => (
        <button
          className="btn btn-sm adm-row-btn"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            setChange(upgradeSomeChange(m, [u.name]));
          }}
        >
          Actualizar
        </button>
      ),
    },
  ];

  return (
    <div className="adm-pane">
      <div className="adm-toolbar">
        <Segmented<View>
          label="Qué ver"
          value={view}
          onChange={setView}
          options={[
            { value: "updates", label: <>Actualizaciones <span className="adm-seg-n">{data ? updates.length : "…"}</span></> },
            { value: "search", label: "Buscar e instalar" },
          ]}
        />
        {view === "updates" && m !== "none" && (
          <>
            <button className="btn btn-sm" onClick={refresh} disabled={disabled || entry.loading} title="Descarga la lista nueva de paquetes y vuelve a mirar (solo lee)">
              {entry.loading ? <span className="spinner adm-spinner-btn" /> : <RefreshCw size={13} />} Comprobar ahora
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => setChange(upgradeAllChange(m, updates.length))} disabled={disabled || updates.length === 0}>
              <Download size={13} /> Actualizar todo
            </button>
            {sec && (secCount ?? 0) > 0 && (
              <button className="btn btn-sm" onClick={() => setChange(sec)} disabled={disabled}>
                <ShieldAlert size={13} /> Solo seguridad ({secCount})
              </button>
            )}
          </>
        )}
        {!elevation && elev.canAskSudo && (
          <button className="btn btn-sm" onClick={askSudo} title="Con sudo se ve la lista del sistema y se puede instalar">
            <KeyRound size={13} /> Con sudo…
          </button>
        )}
        <span className="adm-spacer" />
        {data && (
          <span className="faint">
            {m === "none" ? "Sin gestor de paquetes" : MANAGERS[m].label} · {data.elevated ? "con sudo" : "sin sudo"}
            {entry.at ? ` · ${new Date(entry.at).toLocaleTimeString("es-ES", { timeStyle: "short" })}` : ""}
          </span>
        )}
      </div>
      {entry.error && <Banner text={`No se pudieron leer los paquetes: ${entry.error}`} />}
      {data?.error && <Banner text={`El gestor de paquetes falló: ${data.error}`} />}
      {view === "updates" && data?.warning && <div className="adm-banner"><span className="adm-banner-text faint adm-pre-wrap">{data.warning}</span></div>}
      {view === "updates" && kernels.length > 0 && (
        <div className="adm-banner" role="status">
          <AlertTriangle size={14} />
          <span className="adm-banner-text">Hay un kernel nuevo ({kernels.map((k) => k.version).join(", ")}): después de instalarlo hay que reiniciar el servidor para usarlo{data?.kernel ? ` (ahora: ${data.kernel})` : ""}.</span>
        </div>
      )}
      {view === "updates" && m === "zypper" && (secCount ?? 0) > 0 && <div className="adm-banner"><span className="adm-banner-text">{secCount} parches de seguridad pendientes.</span></div>}
      {!data ? (
        <div className="empty-state">
          {entry.loading ? <span className="spinner" /> : <Package size={22} />}
          <div>{entry.loading ? "Mirando qué hay para actualizar (puede tardar un poco)…" : "Paquetes del servidor"}</div>
        </div>
      ) : m === "none" ? (
        <div className="empty-state">
          <Package size={22} />
          <div>No aplica: no se reconoce el gestor de paquetes (se buscan dnf, yum, apt, zypper y apk).</div>
        </div>
      ) : view === "search" ? (
        <PackageSearch manager={m} kernel={data.kernel} onChange={setChange} onOpenServices={onOpenServices} />
      ) : (
        <VirtualTable
          label="Actualizaciones pendientes"
          columns={columns}
          rows={updates}
          rowKey={(u) => `${u.name}.${u.arch ?? ""}`}
          selected={selected}
          onSelect={setSelected}
          placeholder={<div className="adm-empty-text">{data.error ? "No se pudo saber." : "Todo al día: no hay nada que actualizar."}{m === "apt" && !data.error ? " (según la última lista descargada: pulsa «Comprobar ahora» para bajar la nueva)" : ""}</div>}
        />
      )}
      {change && <ConfigChangeDialog change={change} kind={PACKAGES_JOB} area="Paquetes" onClose={() => setChange(null)} />}
    </div>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <div className="adm-banner adm-banner-warn" role="alert">
      <AlertTriangle size={14} />
      <span className="adm-banner-text adm-pre-wrap">{text}</span>
    </div>
  );
}
