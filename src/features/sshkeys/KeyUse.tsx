// La llave pública y los dos caminos para usarla: en un servidor o en GitHub.
// Lo usan el asistente (al terminar) y Ajustes → Llaves SSH (con una llave que ya existe).
import { useState } from "react";
import { Copy } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { copyText } from "./copy";
import { useTopEscape } from "./useTopEscape";
import { PutOnServer } from "./PutOnServer";
import { PutOnGitHub } from "./PutOnGitHub";
import "./SshKeys.css";

/** Lo mínimo de una llave para usarla. */
export interface KeyToUse {
  name: string;
  privatePath: string;
  publicLine: string;
  comment: string;
}

type Where = "server" | "github";

const WHERE: { value: Where; label: string }[] = [
  { value: "server", label: "En un servidor" },
  { value: "github", label: "En GitHub" },
];

export function KeyUse({ k, serverId }: { k: KeyToUse; serverId?: string }) {
  const [where, setWhere] = useState<Where>("server");
  return (
    <>
      <div className="field">
        <span>Llave pública (esta sí se comparte)</span>
        <div className="sk-pub">
          <code className="sk-pub-line">{k.publicLine}</code>
          <button className="btn btn-sm" onClick={() => void copyText(k.publicLine, "Llave pública copiada")}>
            <Copy size={13} /> Copiar
          </button>
        </div>
      </div>
      <div className="field">
        <span>¿Dónde la vas a usar?</span>
        <div className="cd-segmented" role="radiogroup" aria-label="Dónde usar la llave">
          {WHERE.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={where === o.value}
              className={where === o.value ? "active" : ""}
              onClick={() => setWhere(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {where === "server" ? (
        <PutOnServer publicLine={k.publicLine} defaultServerId={serverId} />
      ) : (
        <PutOnGitHub publicLine={k.publicLine} name={k.name} privatePath={k.privatePath} comment={k.comment} />
      )}
    </>
  );
}

/** Ventana «Usar la llave …» para una llave que ya existe. */
export function UseKeyDialog({ k, onClose }: { k: KeyToUse; onClose: () => void }) {
  useTopEscape(onClose);
  return (
    <Modal
      open
      title={`Usar la llave ${k.name}`}
      onClose={onClose}
      width="min(640px, 94vw)"
      footer={
        <button className="btn btn-primary" onClick={onClose} autoFocus>
          Listo
        </button>
      }
    >
      <div className="sk-form">
        <KeyUse k={k} />
      </div>
    </Modal>
  );
}
