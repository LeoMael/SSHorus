// Campos de arriba de la barra lateral: conexión rápida (usuario@host:puerto) y búsqueda.
import { useState } from "react";
import { Search, X, Zap } from "lucide-react";
import { openOrFocusServer } from "../../features/connect/connect";
import { useProfiles } from "../../stores/profiles";
import { parseQuickConnect } from "./quickConnect";

/** Conecta (guardándolo antes si es nuevo) al destino escrito. `onConnected` recibe el servidor usado. */
function QuickConnect({ onConnected }: { onConnected: (serverId: string) => void }) {
  const [quick, setQuick] = useState("");
  const [quickError, setQuickError] = useState<string | null>(null);

  const submitQuick = async () => {
    const t = parseQuickConnect(quick);
    if (typeof t === "string") {
      setQuickError(t);
      return;
    }
    const st = useProfiles.getState();
    let server = st.servers.find((s) => s.host === t.host && s.port === t.port && s.username === t.username) ?? null;
    if (!server) {
      server = await st.saveServer({
        id: "",
        name: t.host,
        host: t.host,
        port: t.port,
        username: t.username,
        auth: "password",
        keyPath: null,
        defaultPath: null,
        color: null,
      });
      if (!server) return;
    }
    setQuick("");
    setQuickError(null);
    onConnected(server.id);
    void openOrFocusServer(server);
  };

  return (
    <>
      <div className={`sb-input-wrap${quickError ? " invalid" : ""}`}>
        <Zap size={13} className="sb-input-icon" />
        <input
          className="sb-input mono"
          value={quick}
          spellCheck={false}
          autoCapitalize="off"
          placeholder="usuario@host:puerto"
          aria-label="Conexión rápida"
          title="Conexión rápida: escribe usuario@host:puerto y pulsa Enter"
          onChange={(e) => {
            setQuick(e.target.value);
            setQuickError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submitQuick();
            else if (e.key === "Escape") {
              setQuick("");
              setQuickError(null);
            }
          }}
        />
      </div>
      {quickError && <div className="sb-input-error">{quickError}</div>}
    </>
  );
}

function SearchBox({ query, setQuery }: { query: string; setQuery: (v: string) => void }) {
  return (
    <div className="sb-input-wrap">
      <Search size={13} className="sb-input-icon" />
      <input
        className="sb-input"
        value={query}
        placeholder="Buscar"
        aria-label="Buscar servidores"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setQuery("")}
      />
      {query && (
        <button className="sb-clear" aria-label="Limpiar búsqueda" onClick={() => setQuery("")}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}

interface Props {
  query: string;
  setQuery: (v: string) => void;
  onQuickConnected: (serverId: string) => void;
}

export function SidebarInputs({ query, setQuery, onQuickConnected }: Props) {
  return (
    <div className="sb-inputs">
      <QuickConnect onConnected={onQuickConnected} />
      <SearchBox query={query} setQuery={setQuery} />
    </div>
  );
}
