// Asistente de llaves → «Ponerla en un servidor»: añade la pública a ~/.ssh/authorized_keys de un servidor guardado.
import { useState } from "react";
import { CheckCircle2, Server } from "lucide-react";
import { errorMessage } from "../../api/core";
import { useProfiles } from "../../stores/profiles";
import { ServerSelect } from "../../components/GitHub/parts";
import { addAuthorizedKeysScript, parseAddResult } from "../github/shell";
import { ensureSession, execOk } from "../github/session";

type Result = { ok: true; text: string } | { ok: false; text: string };

export function PutOnServer({ publicLine, defaultServerId }: { publicLine: string; defaultServerId?: string }) {
  const [serverId, setServerId] = useState(defaultServerId ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const server = useProfiles((s) => s.servers.find((x) => x.id === serverId));

  const add = async () => {
    if (!server) return;
    setBusy(true);
    setResult(null);
    try {
      const sessionId = await ensureSession(server.id);
      if (!sessionId) throw new Error("No se pudo conectar con el servidor");
      const r = await execOk(sessionId, addAuthorizedKeysScript([publicLine]), 30);
      const { added } = parseAddResult(r.stdout);
      setResult({
        ok: true,
        text: added
          ? `Listo: ${server.username}@${server.host} ya acepta esta llave.`
          : `Esta llave ya estaba en ${server.username}@${server.host}.`,
      });
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sk-path">
      <p className="sk-text">
        Se añade la llave pública a <span className="mono">~/.ssh/authorized_keys</span> del usuario con el que entras.
        Si no estás conectado, se abre la conexión.
      </p>
      <div className="sk-inline">
        <ServerSelect
          value={serverId}
          onChange={(id) => {
            setServerId(id);
            setResult(null);
          }}
        />
        <button className="btn btn-primary" disabled={!server || busy} onClick={() => void add()}>
          {busy ? <span className="spinner sk-spinner" /> : <Server size={14} />} Añadir la llave
        </button>
      </div>
      {result && (
        <div className={result.ok ? "sk-result sk-result-ok" : "sk-result sk-result-bad"} role="status">
          {result.ok && <CheckCircle2 size={14} />}
          <span>{result.text}</span>
        </div>
      )}
      {result?.ok && (
        <p className="sk-text faint">
          Para entrar con ella: edita el servidor y en «Autenticación» elige «Llave SSH».
        </p>
      )}
    </div>
  );
}
