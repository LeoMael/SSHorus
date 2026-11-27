// «Buscar e instalar» de Paquetes: busca en los repositorios, dice cuáles ya están instalados y ofrece
// instalar o quitar. Antes de quitar se simula para enseñar qué más se iría con él (y avisar si es algo
// sin lo que el servidor no arranca o no te deja entrar).
import { useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { errorMessage } from "../../../api/core";
import { installChange, removeChange, searchPackages, simulateRemove, validPackage, type Found, type PkgManager } from "../../../features/packages";
import type { ConfigChange } from "../../../features/serverConfig";
import { useAdmin } from "../context";

export function PackageSearch({
  manager,
  kernel,
  onChange,
  onOpenServices,
}: {
  manager: Exclude<PkgManager, "none">;
  kernel: string | null;
  onChange: (c: ConfigChange | null) => void;
  onOpenServices: () => void;
}) {
  const { sessionId, elevation, disabled } = useAdmin();
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valid = validPackage(term.trim());

  const search = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      setFound(await searchPackages(sessionId, manager, term));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    setChecking(name);
    const pre = await simulateRemove(sessionId, manager, name, elevation);
    setChecking(null);
    if (pre.blocked) setError(pre.blocked);
    else onChange(removeChange(manager, name, pre.removed, kernel));
  };

  return (
    <div className="svc-scroll">
      <form
        className="svc-logs-bar"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="adm-search adm-search-wide">
          <Search size={13} />
          <input className="input" placeholder="Nombre del paquete (nginx, htop, fail2ban…)" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar paquetes" autoFocus />
        </div>
        <button className="btn btn-sm btn-primary" type="submit" disabled={disabled || busy || !valid}>
          {busy ? <span className="spinner adm-spinner-btn" /> : <Search size={13} />} Buscar
        </button>
        {term && !valid && <span className="faint">Una sola palabra: letras, números, «.», «-», «_» o «+».</span>}
      </form>
      {error && <div className="adm-error" role="alert"><pre>{error}</pre></div>}
      {found && (
        <div className="svc-section">
          <div className="svc-section-head">
            {found.length ? `${found.length} paquetes` : "Nada con ese nombre"}
            <span className="faint">{found.length >= 150 ? "(solo los 150 primeros: afina la búsqueda)" : ""}</span>
          </div>
          {found.length > 0 && (
            <div className="svc-list">
              {found.map((f) => (
                <div key={f.name} className="svc-item pkg-item">
                  <span className="adm-name" title={f.name}>
                    {f.name}
                    {f.installed && <span className="adm-tag adm-tag-green">Instalado</span>}
                  </span>
                  <span className="faint" title={f.summary}>{f.summary}</span>
                  <span className="svc-actions">
                    {f.installed ? (
                      <button className="btn btn-sm adm-row-btn adm-btn-danger-soft" onClick={() => void remove(f.name)} disabled={disabled || checking !== null}>
                        {checking === f.name ? <span className="spinner adm-spinner-btn" /> : null} Quitar…
                      </button>
                    ) : (
                      <button className="btn btn-sm adm-row-btn" onClick={() => onChange(installChange(manager, f.name))} disabled={disabled}>
                        Instalar…
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <button className="btn btn-sm" onClick={onOpenServices}>
        Si instalaste un servicio, arráncalo en Servicios <ArrowRight size={13} />
      </button>
    </div>
  );
}
