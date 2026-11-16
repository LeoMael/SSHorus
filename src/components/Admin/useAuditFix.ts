// Estado de «Arreglar» en la auditoría (uno o varios): ejecución cancelable, resultado de cada arreglo y
// la comprobación posterior, que actualiza y guarda el informe.
import { useRef, useState } from "react";
import type { AuditReport, Check } from "../../api/audit";
import { snippets } from "../../api/snippets";
import { fixAndRecheck, type FixResult, type RecheckOutcome } from "../../features/audit";
import { useAdmin } from "./context";

export type FixPhase = "idle" | "running" | "done";

export function useAuditFix(onUpdated: (report: AuditReport, outcomes: RecheckOutcome[]) => void) {
  const { sessionId, profileId, serverName, elevation } = useAdmin();
  const [phase, setPhase] = useState<FixPhase>("idle");
  const [results, setResults] = useState<Record<string, FixResult>>({});
  const [outcomes, setOutcomes] = useState<Record<string, RecheckOutcome>>({});
  const [recheckError, setRecheckError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const execId = useRef<string | null>(null);
  const canceled = useRef(false);

  const start = async (report: AuditReport, checks: Check[]) => {
    if (!elevation || phase === "running") return;
    canceled.current = false;
    setPhase("running");
    setResults({});
    setOutcomes({});
    setRecheckError(null);
    const out = await fixAndRecheck({
      sessionId,
      profileId,
      serverName,
      elevation,
      report,
      checks,
      onExec: (id) => {
        execId.current = id;
        setExecuting(id !== null);
      },
      canceled: () => canceled.current,
      onResult: (id, r) => setResults((s) => ({ ...s, [id]: r })),
    });
    if (out.recheck) {
      setOutcomes(Object.fromEntries(out.recheck.outcomes.map((o) => [o.id, o])));
      onUpdated(out.recheck.report, out.recheck.outcomes);
    }
    setRecheckError(out.recheckError);
    setPhase("done");
  };

  /** Para el comando en curso (también en el servidor) y no empieza los siguientes. */
  const cancel = () => {
    canceled.current = true;
    if (execId.current) void snippets.cancelExec(execId.current);
  };

  return { phase, results, outcomes, recheckError, executing, start, cancel };
}
