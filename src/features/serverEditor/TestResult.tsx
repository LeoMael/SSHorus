import { CircleCheck, CircleX } from "lucide-react";
import type { AuthMethod } from "../../api/types";
import { describeTestOk, type TestOutcome } from "../serverTest";
import type { TestReason } from "./useConnectionTest";

/** Resultado de «Probar conexión» dentro del formulario. */
export function TestResult({
  testing,
  outcome,
  auth,
  onSaveAnyway,
}: {
  testing: TestReason | null;
  outcome: TestOutcome | null;
  auth: AuthMethod;
  onSaveAnyway: () => void;
}) {
  if (testing) {
    return (
      <div className="cd-test" role="status">
        <span className="spinner cd-btn-spinner" />
        <span>
          {testing === "save" ? "Probando la conexión antes de guardar…" : "Probando la conexión…"}{" "}
          <span className="faint">(máx. 10 s)</span>
        </span>
      </div>
    );
  }
  if (!outcome) return null;
  if (outcome.status === "canceled") {
    return (
      <div className="cd-test" role="status">
        <span className="faint">Prueba cancelada.</span>
      </div>
    );
  }
  if (outcome.status === "ok") {
    const partial = outcome.result.skipped !== null;
    return (
      <div className={`cd-test ${partial ? "cd-test-partial" : "cd-test-ok"}`} role="status">
        <CircleCheck size={15} />
        <span>{describeTestOk(outcome.result, auth)}</span>
      </div>
    );
  }
  return (
    <div className="cd-test cd-test-error" role="alert">
      <CircleX size={15} />
      <div className="cd-test-body">
        <span>{outcome.message}</span>
        <span className="cd-test-actions">
          <span className="faint">¿Está apagado ahora? Puedes guardarlo igualmente.</span>
          <button type="button" className="ssha-linkbtn" onClick={onSaveAnyway}>
            Guardar de todos modos
          </button>
        </span>
      </div>
    </div>
  );
}
