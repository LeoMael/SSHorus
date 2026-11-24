// Diálogo de `run_with_password`: la IA quiere ejecutar un programa que pide una contraseña. Muestra servidor,
// comando y motivo; el usuario elige la contraseña guardada (por defecto, si hay), escribe otra o no lo
// permite. Si el programa hace otra pregunta, el mismo diálogo pregunta qué contraseña poner ahí.
// Siempre se pregunta: ni «Permitir siempre» ni «Aceptar automáticamente». La IA nunca ve la contraseña.
import { useEffect, useState } from "react";
import { AlertTriangle, Bot, KeyRound } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { PasswordInput } from "../lock/PasswordInput";
import { useLock } from "../lock/lockStore";
import { buildReply, initialChoice, passwordOptions, type PasswordAsk, type PasswordChoice } from "./passwordAsk";
import { cancelAllPasswordAsks, finishPasswordAsk, usePasswordAsks } from "./passwordRun";
import { useSecondsLeft } from "./useSecondsLeft";
import "./Mcp.css";
import "./PasswordRun.css";

function PasswordRunDialog({ ask }: { ask: PasswordAsk }) {
  const left = useSecondsLeft(ask.expiresAt);
  const [choice, setChoice] = useState<PasswordChoice>(() => initialChoice(ask));
  const reply = buildReply(ask, choice);
  const who = ask.client ? `La IA (${ask.client})` : "La IA";
  const isRun = ask.kind === "run";
  const no = () => finishPasswordAsk(ask.id);
  const send = () => reply && finishPasswordAsk(ask.id, reply);

  return (
    <Modal
      open
      title={isRun ? "La IA quiere ejecutar un programa que pide contraseña" : "El programa pide otra contraseña"}
      onClose={no}
      width="min(580px, 94vw)"
      footer={
        <>
          <span className="mcp-countdown" aria-live="polite">
            Se cancelará solo en {left} s
          </span>
          <button className="btn" onClick={no}>
            {isRun ? "No permitir" : "Detener el programa"}
          </button>
          <button className="btn btn-primary" onClick={send} disabled={!reply}>
            <KeyRound size={13} /> {isRun ? "Ejecutar" : "Escribirla"}
          </button>
        </>
      }
    >
      <div className="mcp-ask">
        <p className="mcp-ask-lead">
          <Bot size={16} /> {who} en <strong>{ask.serverName}</strong>
          {ask.user ? ` (como ${ask.user})` : ""}:
        </p>
        <pre className="mcp-command">{ask.command}</pre>
        {isRun && ask.reason && (
          <p className="mcp-pw-reason">
            <strong>Motivo:</strong> {ask.reason}
          </p>
        )}
        {!isRun && (
          <p className="mcp-pw-reason">
            El programa pregunta: <strong>{ask.prompt}</strong>
          </p>
        )}
        {isRun && ask.danger.length > 0 && (
          <div className="mcp-danger" role="alert">
            <AlertTriangle size={16} />
            <div>{ask.danger.join(" · ")}</div>
          </div>
        )}
        <fieldset className="mcp-pw-options">
          <legend>Contraseña que escribe SSHorus</legend>
          {passwordOptions(ask).map((o) => {
            const checked = choice.source === o.source && (o.source !== "reuse" || choice.reuse === o.reuse);
            return (
              <label key={`${o.source}-${o.reuse ?? ""}`} className="mcp-pw-option">
                <input
                  type="radio"
                  name={`pw-${ask.id}`}
                  checked={checked}
                  onChange={() => setChoice((c) => ({ ...c, source: o.source, reuse: o.reuse ?? c.reuse }))}
                />
                {o.label}
              </label>
            );
          })}
          {choice.source === "typed" && (
            <PasswordInput
              value={choice.typed}
              onChange={(typed) => setChoice((c) => ({ ...c, typed }))}
              onEnter={send}
              label="Contraseña"
              placeholder="Contraseña"
              autoFocus
            />
          )}
        </fieldset>
        {isRun && (
          <label className="mcp-pw-option">
            <input
              type="checkbox"
              checked={choice.sameForAll}
              onChange={(e) => setChoice((c) => ({ ...c, sameForAll: e.target.checked }))}
            />
            Usar la misma si el programa vuelve a preguntar (p. ej. «repite la contraseña»)
          </label>
        )}
        <p className="mcp-ask-hint">
          La IA no verá la contraseña: SSHorus la escribe cuando el programa la pide y la tapa en la salida. Revisa el
          comando: un programa que muestre lo que escribes de otra forma podría dejarla ver.
        </p>
      </div>
    </Modal>
  );
}

/** Muestra el primer diálogo de la cola. Se cierran al bloquear SSHorus o cuando el motor deja de esperar. */
export function PasswordRunHost() {
  const first = usePasswordAsks((s) => s.asks[0]);
  const locked = useLock((s) => !!s.status?.locked);

  useEffect(() => {
    if (locked && first) cancelAllPasswordAsks();
  }, [locked, first]);

  useEffect(() => {
    if (!first) return;
    const t = window.setTimeout(() => finishPasswordAsk(first.id), Math.max(0, first.expiresAt - Date.now()));
    return () => window.clearTimeout(t);
  }, [first]);

  if (!first || locked) return null;
  return <PasswordRunDialog key={first.id} ask={first} />;
}
