// Partes del diálogo «Claude Code en este servidor»: estado de Claude Code, cómo llevar la cuenta y el final.
import { Copy, KeyRound, TerminalSquare } from "lucide-react";
import { clipboard } from "../../lib/clipboard";
import { toast } from "../../stores/toasts";
import { MODES, installBlocker, installCommand, type ClaudeVpsMode, type ClaudeVpsStatus } from "../../features/claudeVps";

async function copyText(text: string) {
  try {
    await clipboard.write(text);
    toast.success("Comando copiado");
  } catch (e) {
    toast.error("No se pudo copiar", e);
  }
}

/** Claude Code en el servidor: versión o cómo instalarlo. */
export function ClaudeInstallBox({ st, onType }: { st: ClaudeVpsStatus; onType: (cmd: string) => void }) {
  if (st.claude) {
    return (
      <p className="cvps-line">
        Claude Code está instalado{st.version ? ` (${st.version})` : ""}.
      </p>
    );
  }
  const cmd = installCommand(st);
  return (
    <div className="cvps-install">
      <p className="cvps-line">Claude Code no está instalado en este servidor.</p>
      {cmd ? (
        <>
          <p className="cvps-muted">Se instala con el instalador oficial de Anthropic, para tu usuario (sin sudo):</p>
          <pre className="cvps-cmd">{cmd}</pre>
          <div className="cvps-actions">
            <button type="button" className="btn btn-sm" onClick={() => onType(cmd)}>
              <TerminalSquare size={14} /> Instalar en la terminal
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void copyText(cmd)}>
              <Copy size={14} /> Copiar
            </button>
          </div>
        </>
      ) : (
        <p className="cvps-muted">{installBlocker(st)}</p>
      )}
    </div>
  );
}

/** Las dos formas de llevar la cuenta, con su diferencia en una línea. */
export function ModePicker({ mode, onChange }: { mode: ClaudeVpsMode; onChange: (m: ClaudeVpsMode) => void }) {
  return (
    <div className="cvps-modes" role="radiogroup" aria-label="Cómo llevar tu cuenta">
      {MODES.map((m) => (
        <label key={m.mode} className={`cvps-mode${m.mode === mode ? " selected" : ""}`}>
          <input type="radio" name="cvps-mode" checked={m.mode === mode} onChange={() => onChange(m.mode)} />
          <span className="cvps-mode-text">
            <span className="cvps-mode-label">
              {m.label}
              {m.recommended && <span className="cvps-tag">Recomendada para servidores</span>}
            </span>
            <span className="cvps-muted">{m.line}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** «Llave de acceso»: crearla en este equipo y pegarla. */
export function TokenStep({
  token,
  invalid,
  disabled,
  onToken,
  onCreate,
  onSubmit,
}: {
  token: string;
  invalid: boolean;
  disabled: boolean;
  onToken: (t: string) => void;
  onCreate: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="cvps-step">
      <p className="cvps-muted">
        1. Créala una vez en este equipo: se abre una terminal local con «claude setup-token» y el navegador.
      </p>
      <div className="cvps-actions">
        <button type="button" className="btn btn-sm" onClick={onCreate} disabled={disabled}>
          <KeyRound size={14} /> Crear la llave en este equipo
        </button>
      </div>
      <label className="field">
        <span>2. Pega aquí la llave (empieza por sk-ant-oat01-)</span>
        <input
          type="password"
          className="input"
          value={token}
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-oat01-…"
          disabled={disabled}
          onChange={(e) => onToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
      </label>
      {invalid && <div className="cvps-err">Eso no parece una llave de «claude setup-token»: cópiala entera.</div>}
    </div>
  );
}

/** «Copiar mi sesión»: qué se copia y qué pasa con la sesión que ya tuviera el servidor. */
export function SessionStep({ st }: { st: ClaudeVpsStatus }) {
  return (
    <div className="cvps-step">
      <p className="cvps-muted">
        Se copia tu sesión de Claude Code de este equipo (~/.claude/.credentials.json). SSHorus la lee y la envía
        directamente al servidor: no se muestra en ningún sitio.
      </p>
      {st.creds && !st.session && (
        <p className="cvps-muted">
          El servidor ya tiene una sesión de Claude Code: se guarda una copia y se repone al quitar tu cuenta.
        </p>
      )}
    </div>
  );
}
