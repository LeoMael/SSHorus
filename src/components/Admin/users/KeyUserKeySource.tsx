// Campo «Llave pública» del asistente «Nuevo usuario con clave»: pegar, elegir de ~/.ssh o generar.
import { KeyRound, Sparkles } from "lucide-react";
import { Segmented } from "../../ui/Segmented";
import type { KeySource } from "./useKeySource";

export function KeyUserKeySource({ k }: { k: KeySource }) {
  return (
    <>
      <div className="field">
        <span className="adm-field-label">Llave pública</span>
        <Segmented
          label="Origen de la llave"
          value={k.source}
          onChange={k.setSource}
          options={[
            { value: "paste", label: "Pegar" },
            { value: "local", label: "De este equipo" },
            { value: "generate", label: "Generar nueva" },
          ]}
        />
      </div>
      {k.source === "paste" && (
        <textarea
          className="textarea mono adm-key-input"
          rows={3}
          value={k.pasted}
          spellCheck={false}
          placeholder="ssh-ed25519 AAAA… usuario@equipo"
          onChange={(e) => k.setPasted(e.target.value)}
          aria-label="Llave pública"
        />
      )}
      {k.source === "local" &&
        (k.locals === null ? (
          <div className="adm-loading">
            <span className="spinner" /> Leyendo ~/.ssh…
          </div>
        ) : k.locals.length === 0 ? (
          <div className="adm-note">No hay llaves públicas (*.pub) en ~/.ssh de este equipo.</div>
        ) : (
          <select className="select mono" value={k.localPath} onChange={(e) => k.setLocalPath(e.target.value)} aria-label="Llave de este equipo">
            {k.locals.map((l) => (
              <option key={l.path} value={l.path}>
                {l.path.split(/[\\/]/).pop()} · {l.line.split(/\s+/)[0]} {l.line.split(/\s+/).slice(2).join(" ")}
              </option>
            ))}
          </select>
        ))}
      {k.source === "generate" &&
        (k.generated ? (
          <div className="adm-note">
            <KeyRound size={13} /> Llave ed25519 guardada en <span className="mono">{k.generated.privatePath}</span> (permisos
            600{k.generated.passphrase ? ", con frase" : ""}). La privada no sale de este equipo; al servidor solo va:
            <pre className="adm-cmd adm-cmd-sm">{k.generated.line}</pre>
          </div>
        ) : (
          <div className="field-row">
            <label className="field">
              <span>Archivo en ~/.ssh</span>
              <input className="input mono" value={k.genName} spellCheck={false} placeholder={k.suggested} onChange={(e) => k.setGenName(e.target.value)} />
            </label>
            <label className="field">
              <span>Frase (opcional)</span>
              <input className="input" type="password" value={k.genPass} autoComplete="new-password" onChange={(e) => k.setGenPass(e.target.value)} />
            </label>
            <div className="field adm-field-check">
              <button type="button" className="btn btn-sm" onClick={k.generate} disabled={k.genBusy}>
                {k.genBusy ? <span className="spinner adm-spinner-btn" /> : <Sparkles size={13} />} Generar
              </button>
            </div>
          </div>
        ))}
    </>
  );
}
