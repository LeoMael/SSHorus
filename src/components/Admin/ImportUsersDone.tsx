// «Añadir a SSHorus»: servidores creados y prueba de su conexión.
import { useEffect } from "react";
import { CheckCircle2, PlugZap, XCircle } from "lucide-react";
import type { ServerProfile } from "../../api/types";
import { useConnectionTests, type TestState } from "./useImportUsers";

function TestCell({ t }: { t: TestState | undefined }) {
  if (!t || t.status === "idle") return <span className="faint">Sin probar</span>;
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
  autoTest,
  onClose,
}: {
  saved: ServerProfile[];
  failed: number;
  autoTest: boolean;
  onClose: () => void;
}) {
  const { tests, runAll, running } = useConnectionTests(saved);

  useEffect(() => {
    if (autoTest && saved.length) void runAll();
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
                <span className="adm-name">{s.name}</span>
                <span className="faint mono">{s.auth === "password" ? "contraseña" : s.auth === "key" ? s.keyPath : "agente SSH"}</span>
                <TestCell t={tests[s.id]} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn adm-footer-left" onClick={() => void runAll()} disabled={running || !saved.length}>
          <PlugZap size={13} /> Probar conexiones
        </button>
        <button className="btn btn-primary" onClick={onClose} autoFocus>
          Cerrar
        </button>
      </div>
    </>
  );
}
