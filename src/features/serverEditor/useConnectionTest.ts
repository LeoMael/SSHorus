// «Probar conexión» del formulario: prueba en curso, último resultado y cancelación.
import { useEffect, useRef, useState } from "react";
import { ssh } from "../../api/ssh";
import type { ServerProfile } from "../../api/types";
import { testServerConnection, type TestOutcome, type TestSecrets } from "../connect/serverTest";

/** «manual» (botón) o «save» (al guardar). */
export type TestReason = "manual" | "save";

/** `testSig`: firma de los datos actuales; un resultado solo vale mientras no cambie. */
export function useConnectionTest(testSig: string) {
  const [test, setTest] = useState<{ sig: string; outcome: TestOutcome } | null>(null);
  const [testing, setTesting] = useState<TestReason | null>(null);
  const runRef = useRef<{ id: string | null; canceled: boolean; sig: string } | null>(null);
  const testBoxRef = useRef<HTMLDivElement>(null);
  /** Resultado de la última prueba si sigue valiendo para los datos actuales. */
  const current = test && test.sig === testSig ? test.outcome : null;

  /** Cancela la prueba en curso. Devuelve si había una. */
  const cancelTest = (): boolean => {
    const run = runRef.current;
    if (!run) return false;
    run.canceled = true;
    runRef.current = null;
    if (run.id) ssh.cancelTest(run.id).catch(() => {});
    setTesting(null);
    setTest({ sig: run.sig, outcome: { status: "canceled" } });
    return true;
  };
  // Al cerrar el editor no se deja ninguna prueba en marcha.
  const cancelRef = useRef(cancelTest);
  cancelRef.current = cancelTest;
  useEffect(() => () => void cancelRef.current(), []);

  useEffect(() => {
    if (test) testBoxRef.current?.scrollIntoView({ block: "nearest" });
  }, [test]);

  /** Prueba la conexión con `server` (nada se guarda). null = cancelada. */
  const startTest = async (why: TestReason, server: ServerProfile, secrets: TestSecrets): Promise<TestOutcome | null> => {
    cancelRef.current();
    const run = { id: null as string | null, canceled: false, sig: testSig };
    runRef.current = run;
    setTesting(why);
    setTest(null);
    const outcome = await testServerConnection(
      server,
      secrets,
      (id) => (run.id = id),
      () => run.canceled,
    );
    if (runRef.current !== run) return null; // cancelada o cerrada
    runRef.current = null;
    setTesting(null);
    setTest({ sig: run.sig, outcome });
    return outcome.status === "canceled" ? null : outcome;
  };

  return { testing, current, failedNow: current?.status === "error", testBoxRef, cancelTest, startTest };
}
