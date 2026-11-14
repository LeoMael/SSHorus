// Ajustes → Llaves SSH: las llaves de este equipo (~/.ssh), copiar su parte pública, usarlas en un
// servidor o en GitHub y crear una nueva.
import { useState } from "react";
import { Copy, KeyRound, RefreshCw, Send } from "lucide-react";
import { SettingGroup, SettingRow as Row } from "../ui/SettingsKit";
import type { LocalPrivateKey } from "../../api/localkeys";
import { useLocalKeysOnMount } from "../../features/sshkeys/store";
import { keyDetails } from "../../features/sshkeys/keys";
import { copyText } from "../../features/sshkeys/copy";
import { CreateKeyWizard } from "../../features/sshkeys/CreateKeyWizard";
import { UseKeyDialog, type KeyToUse } from "../../features/sshkeys/KeyUse";
import "../../features/sshkeys/SshKeys.css";

/** Datos para «Usar…» (solo si se conoce la parte pública). */
function toUse(k: LocalPrivateKey): KeyToUse | null {
  return k.publicLine ? { name: k.name, privatePath: k.path, publicLine: k.publicLine, comment: k.comment } : null;
}

function KeyRow({ k, onUse }: { k: LocalPrivateKey; onUse: (k: KeyToUse) => void }) {
  const use = toUse(k);
  return (
    <Row label={<span className="sk-list-name">{k.name}</span>} hint={keyDetails(k)}>
      <div className="sk-row-actions">
        <button
          className="btn btn-sm"
          disabled={!k.publicLine}
          title={k.publicLine ? "Copiar la llave pública" : "No se encontró su parte pública (.pub)"}
          onClick={() => k.publicLine && void copyText(k.publicLine, "Llave pública copiada")}
        >
          <Copy size={13} /> Copiar pública
        </button>
        <button className="btn btn-sm" disabled={!use} onClick={() => use && onUse(use)} title="Ponerla en un servidor o en GitHub">
          <Send size={13} /> Usar…
        </button>
      </div>
    </Row>
  );
}

export function SshKeysSection() {
  const { data, error, loading, reload } = useLocalKeysOnMount();
  const [wizard, setWizard] = useState(false);
  const [using, setUsing] = useState<KeyToUse | null>(null);
  const keys = data?.keys ?? [];

  return (
    <>
      <SettingGroup hint="La llave privada se queda en tu equipo y no se comparte. La pública se pone en el servidor o en GitHub para entrar sin contraseña.">
        <Row label="Crear llave SSH" hint="Tipo ed25519, con frase de paso si quieres.">
          <button className="btn btn-primary" onClick={() => setWizard(true)}>
            <KeyRound size={14} /> Crear llave SSH
          </button>
        </Row>
      </SettingGroup>

      <SettingGroup title="En este equipo" hint={data ? <span className="mono">{data.dir}</span> : undefined}>
        {keys.map((k) => (
          <KeyRow key={k.path} k={k} onUse={setUsing} />
        ))}
        {data && keys.length === 0 && (
          <Row label="Aún no tienes llaves" hint="Crea una con el botón de arriba.">
            <span />
          </Row>
        )}
        {error && (
          <Row label="No se pudo leer la carpeta" hint={error}>
            <span />
          </Row>
        )}
        <Row label="Volver a buscar" hint="Si creaste o copiaste llaves fuera de SSHorus.">
          <button className="btn btn-sm" onClick={() => void reload()} disabled={loading}>
            <RefreshCw size={13} /> Actualizar
          </button>
        </Row>
      </SettingGroup>

      {wizard && <CreateKeyWizard onClose={() => setWizard(false)} />}
      {using && <UseKeyDialog k={using} onClose={() => setUsing(null)} />}
    </>
  );
}
