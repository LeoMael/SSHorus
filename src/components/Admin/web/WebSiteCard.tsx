// Tarjeta de sitio web (puertos, certificado, visitas, rutas) y diálogo «Comprobar configuración».
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, FileText, Lock, LockOpen, RefreshCw, XCircle } from "lucide-react";
import { errorMessage } from "../../../api/core";
import {
  certStatus,
  checkScript,
  findListener,
  isLocalHost,
  uniqueListens,
  type ListenPort,
  type ServerInfo,
  type Site,
  type SiteRoute,
} from "../../../features/admin";
import { readElevated } from "../../../features/privileges";
import { useProfiles } from "../../../stores/profiles";
import { useAdmin } from "../context";
import { AdmModal } from "../../ui/AdmModal";

export const SERVER_NAME: Record<ServerInfo["server"], string> = { nginx: "nginx", caddy: "Caddy" };

export const SOURCE_TEXT: Record<ServerInfo["source"], string> = {
  dump: "configuración completa («nginx -T»)",
  files: "leída de los archivos de configuración",
  api: "configuración en marcha (API local de Caddy)",
  adapt: "Caddyfile convertido con «caddy adapt»",
};

export const WRITE_NOTE = "Para guardar cambios necesitas permiso de escritura en el archivo (normalmente solo root).";

/** ¿Tiene sentido buscar este destino entre los puertos del servidor? */
function localDest(host: string | null, ports: ListenPort[], serverHost: string | null): boolean {
  if (host === null) return true;
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return isLocalHost(h) || h === serverHost?.toLowerCase() || ports.some((p) => p.ip === h);
}

/** Indicador «alguien escucha en :3000» que lleva a Puertos. */
function ListenerBadge({ host, port }: { host: string | null; port: number | null }) {
  const { ports, goToPort, profileId } = useAdmin();
  const serverHost = useProfiles((s) => s.servers.find((x) => x.id === profileId)?.host ?? null);
  if (port === null) return null;
  const list = ports.data?.ports;
  if (!list) return ports.loading ? <span className="faint">comprobando…</span> : null;
  if (!localDest(host, list, serverHost))
    return (
      <span className="faint" title="El destino está en otro equipo">
        otro equipo
      </span>
    );
  const l = findListener(list, host ?? "127.0.0.1", port);
  const who = l ? (l.procs[0]?.name ?? l.container ?? l.unit?.replace(/\.service$/, "") ?? null) : null;
  return (
    <button
      className={`adm-listen ${l ? "ok" : "bad"}`}
      onClick={() => goToPort(port)}
      title={l ? `Ver el puerto ${port} en Puertos` : `Nadie escucha en el puerto ${port}: el sitio dará error. Ver en Puertos`}
    >
      {l ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
      {l ? `escuchando${who ? ` · ${who}` : ""}` : `nadie escucha en :${port}`}
    </button>
  );
}

function RouteTarget({ route }: { route: SiteRoute }) {
  const t = route.target;
  switch (t.kind) {
    case "proxy":
      return (
        <>
          <span className="adm-route-kind">proxy →</span>
          <span className="mono adm-ellipsis" title={t.url}>
            {t.socket ? `socket ${t.socket}` : t.url}
          </span>
          {!t.socket && <ListenerBadge host={t.host} port={t.port} />}
        </>
      );
    case "fastcgi":
      return (
        <>
          <span className="adm-route-kind">FastCGI →</span>
          <span className="mono adm-ellipsis" title={t.addr}>
            {t.addr}
          </span>
          {t.port !== null && <ListenerBadge host={t.host} port={t.port} />}
        </>
      );
    case "files":
      return (
        <>
          <span className="adm-route-kind">archivos en</span>
          <span className="mono adm-ellipsis" title={t.root}>
            {t.root}
          </span>
        </>
      );
    case "redirect":
      return (
        <>
          <span className="adm-route-kind">redirige{t.code ? ` (${t.code})` : ""} a</span>
          <span className="mono adm-ellipsis" title={t.to}>
            {t.to || "—"}
          </span>
        </>
      );
    default:
      return <span className="muted">{t.text}</span>;
  }
}

export function SiteCard({ site, onTraffic }: { site: Site; onTraffic: () => void }) {
  const { openFile, goToPort } = useAdmin();
  const cs = certStatus(site.certExpires);
  const title = site.names[0] ?? (site.server === "caddy" ? "Cualquier dominio" : "Sitio por defecto");
  const where = site.file ? `${site.file}${site.line ? `:${site.line}` : ""}` : null;
  const log = site.accessLog;
  return (
    <article className="adm-site" aria-label={title}>
      <header className="adm-site-head">
        {site.https ? <Lock size={14} className="adm-ok" /> : <LockOpen size={14} className="faint" />}
        <span className="adm-site-name" title={site.names.join(" ")}>
          {title}
        </span>
        {site.isDefault && site.names.length > 0 && <span className="adm-tag adm-tag-accent">por defecto</span>}
        <span className={`adm-tag ${site.https ? "adm-tag-green" : "adm-tag-yellow"}`}>{site.https ? "HTTPS" : "HTTP"}</span>
      </header>
      {site.names.length > 1 && <div className="adm-site-alias mono">{site.names.slice(1).join(" · ")}</div>}

      <dl className="adm-site-info">
        <dt>Puertos</dt>
        <dd className="adm-site-ports">
          {uniqueListens(site.listens).map((l, i) => (
            <button
              key={i}
              className="adm-port-chip"
              onClick={() => l.port > 0 && goToPort(l.port)}
              disabled={l.port <= 0}
              title={l.port > 0 ? `Ver el puerto ${l.port} en Puertos` : undefined}
            >
              {l.host ? `${l.host}:` : ""}
              {l.port || "socket"}
              {l.https && " HTTPS"}
            </button>
          ))}
        </dd>
        {site.https && (
          <>
            <dt>Certificado</dt>
            <dd className="adm-cell-flex">
              {site.cert ? (
                <>
                  <span className="mono adm-ellipsis" title={site.cert}>
                    {site.cert}
                  </span>
                  {cs ? (
                    <span
                      className={`adm-tag ${cs.level === "ok" ? "adm-tag-green" : cs.level === "warn" ? "adm-tag-yellow" : "adm-tag-red"}`}
                    >
                      {cs.text}
                    </span>
                  ) : (
                    <span className="faint" title="Hace falta openssl en el servidor y permiso para leer el certificado">
                      caducidad desconocida
                    </span>
                  )}
                </>
              ) : site.server === "caddy" ? (
                <span className="muted">automático (lo gestiona Caddy)</span>
              ) : (
                <span className="faint">no indicado</span>
              )}
            </dd>
          </>
        )}
        <dt>Visitas</dt>
        <dd className="adm-cell-flex">
          {log?.path ? (
            <>
              <span className="mono adm-ellipsis" title={log.path}>
                {log.path}
              </span>
              {log.shared && (
                <span className="adm-tag adm-tag-yellow" title="Varios sitios comparten este registro">
                  compartido
                </span>
              )}
            </>
          ) : log?.format === "journal" ? (
            <span className="muted">journalctl (Caddy)</span>
          ) : (
            <span className="faint" title="Sin registro de acceso configurado (puedes activarlo desde Tráfico)">
              sin activar
            </span>
          )}
        </dd>
      </dl>

      {site.routes.length > 0 ? (
        <ul className="adm-routes" aria-label="Rutas">
          {site.routes.map((r, i) => (
            <li key={i}>
              <span className="mono adm-route-path" title={r.path}>
                {r.path}
              </span>
              <RouteTarget route={r} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="faint adm-routes-none">Sin rutas reconocidas</div>
      )}

      <footer className="adm-site-foot">
        {where ? (
          <>
            <FileText size={12} aria-hidden="true" />
            <span className="mono adm-ellipsis" title={where}>
              {where}
            </span>
            <button
              className="btn btn-sm adm-row-btn"
              disabled={!openFile}
              onClick={() => site.file && openFile?.(site.file)}
              aria-label={`Abrir archivo de ${title}`}
              title={`${site.line ? `Abrir en el editor (el sitio empieza en la línea ${site.line}). ` : "Abrir en el editor. "}${WRITE_NOTE}`}
            >
              Abrir
            </button>
          </>
        ) : (
          <span className="adm-spacer" />
        )}
        <button
          className="btn btn-sm adm-row-btn"
          onClick={onTraffic}
          aria-label={`Tráfico de ${title}`}
          title="Ver visitas y tráfico bajo demanda (o activar registro)"
        >
          <BarChart3 size={12} aria-hidden="true" /> Tráfico
        </button>
      </footer>
    </article>
  );
}

/** Resultado de «Comprobar configuración» (solo lectura). */
export function WebCheckDialog({ info, onClose }: { info: ServerInfo; onClose: () => void }) {
  const { sessionId, elevation } = useAdmin();
  const [state, setState] = useState<{ busy: boolean; ok: boolean | null; text: string; elevated: boolean }>({
    busy: false,
    ok: null,
    text: "",
    elevated: false,
  });
  const script = checkScript(info);
  const run = useCallback(async () => {
    setState((s) => ({ ...s, busy: true }));
    try {
      const r = await readElevated(sessionId, `${script}\nrc=$?\necho @@rc\necho $rc\necho @@end`, elevation, 40);
      const m = /\n?@@rc\n(\d+)\n@@end\s*$/.exec(r.result.stdout);
      const out = (m ? r.result.stdout.slice(0, m.index) : r.result.stdout).trim();
      setState({ busy: false, ok: m?.[1] === "0", text: out || "(sin salida)", elevated: r.elevated });
    } catch (e) {
      setState({ busy: false, ok: false, text: errorMessage(e), elevated: false });
    }
  }, [sessionId, script, elevation]);
  // Solo al abrir; «Repetir» vuelve a lanzarlo. `run` cambia cuando cambia `elevation` (al escribir la
  // contraseña de sudo o al refrescar los privilegios) y eso no debe repetir la comprobación sola.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);
  return (
    <AdmModal title={`Comprobar configuración de ${SERVER_NAME[info.server]}`} onClose={onClose} width={620}>
      <div className="modal-body adm-review">
        <div className="adm-review-label">Solo comprueba, no cambia nada. Se ejecuta:</div>
        <pre className="adm-cmd">{script.split("\n").slice(1).join("\n")}</pre>
        {state.busy ? (
          <div className="adm-loading">
            <span className="spinner" /> Comprobando…
          </div>
        ) : state.ok === null ? null : (
          <>
            <div className={`adm-check-result ${state.ok ? "ok" : "bad"}`} role="status">
              {state.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              {state.ok ? "La configuración es correcta" : "La configuración tiene errores o no se pudo comprobar"}
            </div>
            <pre className="adm-cmd adm-cmd-sm adm-check-out">{state.text}</pre>
            {!state.elevated && !state.ok && (
              <div className="adm-note adm-note-warn">
                Se comprobó sin root: suele fallar por permisos (archivo de PID, certificados o registros) aunque la configuración
                esté bien. Con sudo el resultado es fiable.
              </div>
            )}
          </>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={() => void run()} disabled={state.busy}>
          <RefreshCw size={13} /> Repetir
        </button>
        <button className="btn btn-primary" onClick={onClose} autoFocus>
          Cerrar
        </button>
      </div>
    </AdmModal>
  );
}
