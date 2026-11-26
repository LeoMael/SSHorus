// Asistente de llaves → «Ponerla en GitHub»: pasos a mano y, con la cuenta conectada, subirla directamente.
import { useEffect, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, Upload } from "lucide-react";
import { github } from "../../api/github";
import { errorMessage } from "../../api/core";
import { openLink } from "../../components/ui/openLink";
import { useGitHub } from "../github/store";
import { GITHUB_NEW_KEY_URL, githubTestCommand } from "./keys";
import { copyText } from "./copy";
import { loadGitHubKeyIds } from "./useKeyUsage";

export function PutOnGitHub({
  publicLine,
  name,
  privatePath,
  comment,
}: {
  publicLine: string;
  name: string;
  privatePath: string;
  comment: string;
}) {
  const testCmd = githubTestCommand(name, privatePath);
  return (
    <div className="sk-path">
      <ol className="sk-steps">
        <li>
          Copia la llave pública.{" "}
          <button className="btn btn-sm" onClick={() => void copyText(publicLine, "Llave pública copiada")}>
            <Copy size={13} /> Copiar
          </button>
        </li>
        <li>
          Abre GitHub (inicia sesión si te lo pide).{" "}
          <button className="btn btn-sm" onClick={() => openLink(GITHUB_NEW_KEY_URL)}>
            <ExternalLink size={13} /> Abrir GitHub
          </button>
        </li>
        <li>Pega la llave en «Key», ponle un título (p. ej. el nombre de tu equipo) y pulsa «Add SSH key».</li>
        <li>
          Pruébala en una terminal: <code className="sk-code">{testCmd}</code>
          <br />
          <span className="faint">Debe responder «Hi tu-usuario! You've successfully authenticated».</span>
        </li>
      </ol>
      <UploadWithAccount publicLine={publicLine} comment={comment} />
    </div>
  );
}

/** Con la cuenta de GitHub conectada en SSHorus, se sube sin salir de la app. */
function UploadWithAccount({ publicLine, comment }: { publicLine: string; comment: string }) {
  const connected = useGitHub((s) => s.connected);
  const account = useGitHub((s) => s.account);
  const [title, setTitle] = useState(comment || "SSHorus");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (useGitHub.getState().connected === null) void useGitHub.getState().refresh();
  }, []);

  if (!connected) return null;

  const upload = async () => {
    setBusy(true);
    setError(null);
    try {
      await github.addKey(title, publicLine);
      setDone(true);
      void loadGitHubKeyIds(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sk-github-account">
      <div className="sk-text">
        O súbela directamente a tu cuenta{account ? ` @${account.login}` : ""} (en vez de los pasos 1 a 3):
      </div>
      {done ? (
        <div className="sk-result sk-result-ok" role="status">
          <CheckCircle2 size={14} /> Llave subida a GitHub. Haz la prueba del paso 4.
        </div>
      ) : (
        <div className="sk-inline">
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título en GitHub"
            aria-label="Título de la llave en GitHub"
          />
          <button className="btn btn-primary" disabled={busy} onClick={() => void upload()}>
            {busy ? <span className="spinner sk-spinner" /> : <Upload size={14} />} Subir a GitHub
          </button>
        </div>
      )}
      {error && <div className="sk-result sk-result-bad">{error}</div>}
    </div>
  );
}
