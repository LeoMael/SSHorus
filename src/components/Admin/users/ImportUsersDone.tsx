// «Añadir a SSHorus»: servidores creados y prueba de su conexión (empieza sola), con el resultado por fila.
import { useEffect } from "react";
import { CheckCircle2, PlugZap, XCircle } from "lucide-react";
import type { ServerProfile } from "../../../api/types";
import { useConnectionTests, type TestState } from "./useImportUsers";

function authText(s: ServerProfile): string {
  if (s.auth === "password") return "Contraseña";
  return s.auth === "key" ? (s.keyPath ?? "") : "Agente SSH";
}

function TestCell({ t }: { t: TestState | undefined }) {
  if (!t || t.status === "idle") return <span className="faint">En espera…</span>;
  if (t.status === "running") return <span className="spinner adm-spinner-btn" aria-label="Probando" />;
  return (
    <span className={t.status === "ok" ? "iu-test-ok" : "iu-test-bad"} role="status">
      {t.status === "ok" ? <CheckCircle2 size={13} className="adm-ok" /> : <XCircle size={13} className="adm-bad" />} {t.message}
    </span>
  );
}

export function ImportUsersDone({
  saved,
  failed,
  onClose,
}: {
  saved: ServerProfile[];
  failed: number;
  onClose: () => void;
}) {
  const { tests, runAll, running } = useConnectionTests(saved);

  useEffect(() => {
    if (saved.length) void runAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="modal-body">
        <p className="dialog-message">
          {saved.length ? (
            <>
              <CheckCircle2 size={14} className="adm-ok" /> {saved.length === 1 ? "Servidor añadido" : `${saved.length} servidores añadidos`} a
              SSHorus.
            </>
          ) : (
            "No se añadió ningún servidor."
          )}
          {failed > 0 && ` ${failed} no se pudieron guardar.`}
        </p>
        {saved.length > 0 && (
          <ul className="iu-done" aria-label="Servidores añadidos">
            {saved.map((s) => (
              <li key={s.id} className="iu-done-row">
                <span className="iu-done-name">
                  <span className="adm-name">{s.name}</span>
                  <span className="faint mono">
                    {s.username}@{s.host}
                  </span>
                </span>
                <span className="faint mono" title={authText(s)}>
                  {authText(s)}
                </span>
                <TestCell t={tests[s.id]} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn adm-footer-left" onClick={() => void runAll()} disabled={running || !saved.length}>
          <PlugZap size={13} /> Probar de nuevo
        </button>
        <button className="btn btn-primary" onClick={onClose} autoFocus>
          Cerrar
        </button>
      </div>
    </>
  );
}
