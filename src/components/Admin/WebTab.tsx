// Sub-pestaña «Sitios web»: grupos de servidores nginx y Caddy, recarga, comprobación y tráfico.
import { useState } from "react";
import { AlertTriangle, FileCode, Globe, KeyRound, RefreshCw, RotateCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { reloadSteps, type Plan, type ServerInfo, type Site } from "../../features/admin";
import { useAdmin } from "./context";
import { PlanModal } from "./PlanReview";
import { WebTrafficDialog } from "./WebTrafficDialog";
import { SERVER_NAME, SOURCE_TEXT, SiteCard, WRITE_NOTE, WebCheckDialog } from "./WebSiteCard";

function statusTag(status: string | null) {
  if (status === null) return <span className="faint">sin servicio systemd</span>;
  if (status === "active") return <span className="adm-tag adm-tag-green">En marcha</span>;
  if (status === "failed") return <span className="adm-tag adm-tag-red">Con fallo</span>;
  if (status === "inactive") return <span className="adm-tag adm-tag-yellow">Parado</span>;
  return <span className="adm-tag adm-tag-yellow">{status}</span>;
}

function ServerGroup({
  info,
  onCheck,
  onReload,
  onTraffic,
}: {
  info: ServerInfo;
  onCheck: () => void;
  onReload: () => void;
  onTraffic: (site: Site) => void;
}) {
  const { elevation, disabled, openFile, elev, askSudo, web } = useAdmin();
  const name = SERVER_NAME[info.server];
  const warning =
    info.server === "nginx" && info.source === "files" && web.elevated && info.sites.length > 0
      ? "«nginx -T» falló aunque se leyó como root: puede que la configuración tenga errores (usa «Comprobar configuración»). Se muestran los archivos tal cual."
      : info.warning;
  const reloadBlock = disabled ? "Sin conexión con el servidor" : !elevation ? "Necesitas root o sudo para recargar" : null;
  return (
    <section className="adm-web-group" aria-label={name}>
      <div className="adm-web-head">
        <Globe size={16} />
        <h3>{name}</h3>
        {statusTag(info.status)}
        <span className="muted adm-web-src">{SOURCE_TEXT[info.source]}</span>
        <span className="adm-spacer" />
        <button
          className="btn btn-sm"
          onClick={onCheck}
          disabled={disabled}
          title={`Comprueba la configuración sin aplicar nada (${info.server === "nginx" ? "nginx -t" : "caddy validate"})`}
        >
          <ShieldCheck size={13} /> Comprobar configuración
        </button>
        <button
          className="btn btn-sm"
          onClick={onReload}
          disabled={!!reloadBlock}
          title={reloadBlock ?? "Comprueba la configuración y, si es correcta, la aplica sin cortar las conexiones"}
        >
          <RotateCw size={13} /> Recargar
        </button>
        <button
          className="btn btn-sm"
          onClick={() => openFile?.(info.configPath)}
          disabled={!openFile}
          title={`Abrir ${info.configPath} en el editor. ${WRITE_NOTE}`}
        >
          <FileCode size={13} /> Abrir archivo principal
        </button>
      </div>
      <div className="adm-web-path faint mono" title="Archivo principal">
        {info.configPath}
      </div>
      {warning && (
        <div className="adm-note adm-note-warn adm-web-warn" role="status">
          <AlertTriangle size={13} />
          <span>
            {warning}
            {web.elevationError && ` (sudo: ${web.elevationError})`}
          </span>
          {!web.elevated && elev.canAskSudo && (
            <button className="btn btn-sm" onClick={askSudo}>
              <KeyRound size={13} /> Leer con sudo
            </button>
          )}
        </div>
      )}
      {info.sites.length === 0 ? (
        !warning && <div className="muted adm-web-none">No hay sitios configurados.</div>
      ) : (
        <div className="adm-sites">
          {info.sites.map((s) => (
            <SiteCard key={s.key} site={s} onTraffic={() => onTraffic(s)} />
          ))}
        </div>
      )}
    </section>
  );
}

export function WebTab() {
  const { web, loadWeb, disabled, ports } = useAdmin();
  const [check, setCheck] = useState<ServerInfo | null>(null);
  const [reload, setReload] = useState<ServerInfo | null>(null);
  const [trafficRef, setTrafficRef] = useState<{ server: ServerInfo["server"]; siteKey: string } | null>(null);

  if (web.error && !web.data) {
    return (
      <div className="empty-state">
        <ShieldAlert size={22} />
        <div>No se pudo leer la configuración de los servidores web</div>
        <div className="faint adm-pre-wrap">{web.error}</div>
        <button className="btn btn-sm" onClick={loadWeb} disabled={disabled}>
          <RefreshCw size={13} /> Reintentar
        </button>
      </div>
    );
  }
  if (!web.data) {
    return (
      <div className="empty-state">
        <span className="spinner" />
        <div>Buscando nginx y Caddy…</div>
      </div>
    );
  }
  if (web.data.servers.length === 0) {
    return (
      <div className="empty-state">
        <Globe size={22} />
        <div>No se encontró nginx ni Caddy en este servidor</div>
        <div className="faint adm-pre-wrap">
          Se buscan los programas «nginx» y «caddy» (también en /usr/sbin y /usr/local/sbin). Si el servidor web está dentro de un
          contenedor, revísalo en la pestaña Contenedores. Apache y otros servidores aún no se muestran aquí.
        </div>
        <button className="btn btn-sm" onClick={loadWeb} disabled={disabled}>
          <RefreshCw size={13} /> Volver a buscar
        </button>
      </div>
    );
  }

  const plan: Plan | null = reload ? { action: `Recargar ${SERVER_NAME[reload.server]}`, steps: reloadSteps(reload) } : null;
  const total = web.data.servers.reduce((n, s) => n + s.sites.length, 0);
  const activeTraffic = trafficRef
    ? (() => {
        const srv = web.data.servers.find((s) => s.server === trafficRef.server);
        const st = srv?.sites.find((x) => x.key === trafficRef.siteKey);
        return srv && st ? { server: srv, site: st } : null;
      })()
    : null;

  return (
    <div className="adm-pane">
      <div className="adm-web-scroll">
        {web.data.servers.map((s) => (
          <ServerGroup
            key={s.server}
            info={s}
            onCheck={() => setCheck(s)}
            onReload={() => setReload(s)}
            onTraffic={(site) => setTrafficRef({ server: s.server, siteKey: site.key })}
          />
        ))}
      </div>
      <div className="adm-statusbar">
        {total} {total === 1 ? "sitio" : "sitios"}
        <span className="faint">·</span>
        <span>{web.elevated ? "leídos como root" : "leídos sin privilegios"}</span>
        {ports.error && (
          <span className="adm-bad" title={ports.error}>
            · no se pudieron leer los puertos
          </span>
        )}
        {(web.loading || ports.loading) && <span className="spinner adm-spinner-btn" aria-label="Actualizando" />}
      </div>
      {check && <WebCheckDialog info={check} onClose={() => setCheck(null)} />}
      {activeTraffic && (
        <WebTrafficDialog
          server={activeTraffic.server}
          site={activeTraffic.site}
          onClose={() => setTrafficRef(null)}
          onLogEnabled={loadWeb}
        />
      )}
      {plan && reload && (
        <PlanModal
          title={plan.action}
          plan={plan}
          runLabel="Recargar"
          onCancel={() => setReload(null)}
          onDone={() => {
            setReload(null);
            loadWeb();
          }}
        >
          <p className="dialog-message">
            Primero se comprueba la configuración; si tiene errores, no se aplica nada. Si es correcta,{" "}
            {SERVER_NAME[reload.server]} la vuelve a cargar sin cortar las conexiones abiertas.
          </p>
        </PlanModal>
      )}
    </div>
  );
}
