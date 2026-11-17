// Ajustes → Asistentes de IA (MCP): encender el servidor, puerto, token, permisos por servidor (con «Solo lo
// marcado» y usuarios protegidos), resumen, aplicar a varios servidores, reglas «Permitir siempre» y la
// configuración lista para copiar en Claude Code o Claude Desktop.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Activity, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { mcp, type McpClientConfig, type McpConfig } from "../../api/mcp";
import { clipboard } from "../../lib/clipboard";
import { useProfiles } from "../../stores/profiles";
import { toast } from "../../stores/toasts";
import { confirmDialog } from "../ui/dialogs";
import { activeAuto, openActivity, refreshAuto, refreshStatus, useMcp } from "../../features/mcp/store";
import { useMinuteClock } from "../../features/mcp/AutoAccept";
import { SudoRevealSetting } from "../../features/mcp/SudoRevealSetting";
import { PROTECTED_NOTE, ProtectedInput } from "../../features/mcp/ProtectedUsers";
import { McpBulk } from "../../features/mcp/McpBulk";
import { McpSummary } from "../../features/mcp/McpSummary";
import { McpServerRow } from "./McpServerRow";
import "../../features/mcp/Mcp.css";
import { SettingGroup, SettingRow as Row } from "../ui/SettingsKit";

const TIMEOUTS = [30, 60, 120, 300];

const DESKTOP_CONFIG_PATH: Record<string, string> = {
  mac: "~/Library/Application Support/Claude/claude_desktop_config.json",
  win: "%APPDATA%\\Claude\\claude_desktop_config.json",
  linux: "~/.config/Claude/claude_desktop_config.json",
};

function desktopConfigPath(): string {
  const p = navigator.userAgent.toLowerCase();
  if (p.includes("mac")) return DESKTOP_CONFIG_PATH.mac;
  if (p.includes("win")) return DESKTOP_CONFIG_PATH.win;
  return DESKTOP_CONFIG_PATH.linux;
}

async function copy(text: string, what: string) {
  try {
    await clipboard.write(text);
    toast.success(`${what} copiado`);
  } catch (e) {
    toast.error("No se pudo copiar", e);
  }
}

function CopyBlock({ title, hint, text }: { title: string; hint?: ReactNode; text: string }) {
  return (
    <div className="st-block mcp-copy">
      <div className="mcp-copy-head">
        <span>{title}</span>
        <button className="btn btn-sm" onClick={() => void copy(text, title)}>
          <Copy size={12} /> Copiar
        </button>
      </div>
      {hint && <small className="muted">{hint}</small>}
      <pre className="mcp-copy-text">{text}</pre>
    </div>
  );
}

export function McpSection() {
  const status = useMcp((s) => s.status);
  const servers = useProfiles((s) => s.servers);
  const [cfg, setCfg] = useState<McpConfig | null>(null);
  const [client, setClient] = useState<McpClientConfig | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState(false);
  const now = useMinuteClock();
  const autoList = activeAuto(useMcp((s) => s.auto), now);
  const enabled = !!status?.enabled;

  const loadClient = useCallback(async () => {
    try {
      setClient(await mcp.clientConfig());
    } catch (e) {
      setClient(null);
      toast.error("No se pudo leer el token", e);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void refreshAuto();
    void mcp.config().then(setCfg).catch(() => {});
  }, []);
  useEffect(() => {
    if (status) setPort(String(status.port));
  }, [status]);
  useEffect(() => {
    if (enabled) void loadClient();
    else setClient(null);
  }, [enabled, loadClient, status?.port]);

  const toggle = async () => {
    setBusy(true);
    try {
      const st = await mcp.setEnabled(!enabled);
      useMcp.setState({ status: st });
      setCfg(await mcp.config());
      if (st.enabled && st.error) toast.error("El servidor MCP no pudo arrancar", st.error);
    } catch (e) {
      toast.error("No se pudo cambiar el servidor MCP", e);
    } finally {
      setBusy(false);
    }
  };

  const applyPort = async () => {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1024 || n > 65535) {
      toast.error("Puerto no válido", "Usa un número entre 1024 y 65535");
      return;
    }
    try {
      const st = await mcp.setPort(n);
      useMcp.setState({ status: st });
      if (st.error) toast.error("No se pudo usar ese puerto", st.error);
      else toast.success(`Escuchando en el puerto ${n}`, "Actualiza la configuración en tu asistente.");
    } catch (e) {
      toast.error("No se pudo cambiar el puerto", e);
    }
  };

  const regenerate = async () => {
    const ok = await confirmDialog({
      title: "Regenerar token",
      message: "Los asistentes configurados con el token actual dejarán de funcionar hasta que copies la configuración nueva.",
      confirmText: "Regenerar",
    });
    if (!ok) return;
    try {
      await mcp.regenerateToken();
      await loadClient();
      toast.success("Token nuevo creado", "Copia otra vez la configuración en tu asistente.");
    } catch (e) {
      toast.error("No se pudo regenerar el token", e);
    }
  };

  const saveGlobalProtected = async (users: string[]) => {
    try {
      setCfg(await mcp.setProtectedGlobal(users));
      return true;
    } catch (e) {
      toast.error("No se pudo guardar la lista", e);
      return false;
    }
  };

  const setTimeoutSecs = async (secs: number) => {
    try {
      setCfg(await mcp.setApprovalTimeout(secs));
      void refreshStatus();
    } catch (e) {
      toast.error("No se pudo guardar", e);
    }
  };

  // Encendido y en marcha no necesita explicación; la dirección va en el tooltip.
  const stateText = !status
    ? "…"
    : !enabled
      ? "Ningún asistente puede usar SSHorus."
      : status.running
        ? undefined
        : status.error ?? "Encendido, pero el servidor no está en marcha.";

  return (
    <>
      <SettingGroup>
        <Row label="Activar el servidor MCP" hint={stateText}>
          <button
            role="switch"
            aria-checked={enabled}
            aria-label="Activar el servidor MCP"
            title={status?.running ? `${status.url} (solo en este equipo)` : undefined}
            className={enabled ? "st-switch on" : "st-switch"}
            onClick={() => void toggle()}
            disabled={busy || !status}
          >
            <span />
          </button>
        </Row>

        {enabled && (
          <>
            <Row label="Puerto">
              <input
                className="input st-num mcp-port"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && void applyPort()}
                aria-label="Puerto"
                title="Solo escucha en este equipo (127.0.0.1)."
              />
              <button className="btn" onClick={() => void applyPort()} disabled={port === String(status?.port)}>
                Aplicar
              </button>
            </Row>

            <Row label="Tiempo para responder" hint="Si no respondes a un permiso, se deniega.">
              <div className="st-segmented" role="radiogroup" aria-label="Tiempo para responder">
                {TIMEOUTS.map((s) => (
                  <button
                    key={s}
                    role="radio"
                    aria-checked={cfg?.approvalTimeoutSecs === s}
                    className={cfg?.approvalTimeoutSecs === s ? "active" : ""}
                    onClick={() => void setTimeoutSecs(s)}
                  >
                    {s < 60 ? `${s} s` : `${s / 60} min`}
                  </button>
                ))}
              </div>
            </Row>

            <SudoRevealSetting cfg={cfg} onChange={setCfg} />

            <Row label="Token" hint="Lo usa el asistente. Se guarda como tus contraseñas.">
              <code className="mcp-token">{client ? (showToken ? client.token : "tv_" + "•".repeat(16)) : "…"}</code>
              <button className="icon-btn" onClick={() => setShowToken((v) => !v)} title={showToken ? "Ocultar" : "Ver"} aria-label={showToken ? "Ocultar token" : "Ver token"}>
                {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button className="icon-btn" onClick={() => client && void copy(client.token, "Token")} title="Copiar" aria-label="Copiar token">
                <Copy size={14} />
              </button>
              <button className="btn btn-sm" onClick={() => void regenerate()}>
                <RefreshCw size={12} /> Regenerar
              </button>
            </Row>
          </>
        )}

        <Row label="Actividad del asistente" hint="Qué hizo, dónde y quién lo aprobó.">
          <button className="btn" onClick={openActivity}>
            <Activity size={14} /> Ver actividad
          </button>
        </Row>
      </SettingGroup>

      <SettingGroup title="Permisos por servidor" hint="Lo peligroso (rm -rf, sudo, reboot…) se pregunta siempre.">
        <Row label="Usuarios protegidos en todos los servidores" hint={PROTECTED_NOTE}>
          <ProtectedInput
            value={cfg?.protectedGlobal ?? []}
            onSave={saveGlobalProtected}
            label="Usuarios protegidos en todos los servidores"
          />
        </Row>
        {servers.length === 0 ? (
          <div className="st-block muted">Aún no tienes servidores guardados.</div>
        ) : (
          servers.map((s) => (
            <McpServerRow
              key={s.id}
              server={s}
              cfg={cfg}
              onChange={setCfg}
              auto={autoList.find((a) => a.serverId === s.id)}
              now={now}
            />
          ))
        )}
      </SettingGroup>

      {servers.length > 0 && (
        <SettingGroup title="Resumen" hint="Qué puede hacer el asistente en cada servidor.">
          <McpSummary cfg={cfg} />
        </SettingGroup>
      )}

      {servers.length > 1 && (
        <SettingGroup title="Aplicar a varios servidores" hint="El mismo nivel, plantilla o usuarios protegidos en los servidores que elijas.">
          <McpBulk onChange={setCfg} />
        </SettingGroup>
      )}

      {enabled && client && status && (
        <SettingGroup title="Conectar tu asistente" hint="SSHorus debe estar abierto. Lleva el token: no lo compartas.">
          {!status.bridgeFound && (
            <p className="st-block mcp-warn">
              No se encontró el programa puente en {status.bridgePath}. Usa la opción por HTTP o instala SSHorus con su
              instalador.
            </p>
          )}
          {status.appImage && (
            <p className="st-block mcp-warn">Con la AppImage la ruta del puente cambia en cada arranque: usa la opción por HTTP.</p>
          )}
          <CopyBlock
            title="Claude Code (puente stdio)"
            hint="Añade «--scope user» para usarlo en todos tus proyectos."
            text={client.claudeCodeStdio}
          />
          <CopyBlock title="Claude Code (HTTP directo)" hint="Alternativa sin puente." text={client.claudeCodeHttp} />
          <CopyBlock
            title="Claude Desktop"
            hint={
              <>
                Añádelo a <span className="mono">{desktopConfigPath()}</span> y reinicia Claude Desktop.
              </>
            }
            text={client.claudeDesktopJson}
          />
        </SettingGroup>
      )}
    </>
  );
}
