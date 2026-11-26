// «Por usuario» y «Procesos» del Monitor. Si /proc oculta los procesos de otros usuarios (hidepid), con
// sudo se leen como root para verlos todos; sin sudo, se muestra lo que se ve y se dice por qué.
import { lazy, Suspense, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import {
  ELEVATED_MIN_INTERVAL,
  filterByUser,
  procScope,
  setSampleElevation,
  userRowText,
  type Metrics,
  type ProcScope,
  type SessionMonitor,
} from "../../features/monitor";
import { useElevation, usePrivilege, useStoredSudo } from "../../features/privileges";
import { ProcessTable } from "./ProcessTable";
import { UsersSummary } from "./UsersSummary";
import { UserContainersNote } from "./UserContainersNote";

const SudoDialog = lazy(() => import("../Sudo/SudoDialog").then((m) => ({ default: m.SudoDialog })));

const SCOPE_TEXT: Record<ProcScope, string> = {
  all: "Ves los procesos de todos los usuarios.",
  "all-sudo": `Con sudo: ves los procesos de todos los usuarios (se actualiza cada ${ELEVATED_MIN_INTERVAL / 1000} s como mínimo).`,
  own: "Este servidor oculta los procesos de los demás usuarios: solo ves los tuyos. Con sudo verías los procesos de todos.",
};

interface ProcessesSectionProps {
  sessionId: string;
  profileId: string;
  m: Metrics;
  mon: SessionMonitor;
  sort: "cpu" | "mem";
  onSort: (s: "cpu" | "mem") => void;
  /** El panel se ve. */
  live: boolean;
  disabled: boolean;
}

export function ProcessesSection({ sessionId, profileId, m, mon, sort, onSort, live, disabled }: ProcessesSectionProps) {
  const info = usePrivilege(sessionId);
  const elev = useElevation(sessionId, info);
  const hidepid = !!mon.info?.hidepid;
  const myUid = mon.info?.uid ?? null;
  const [picked, setPicked] = useState<number | null>(null);
  const [sudoOpen, setSudoOpen] = useState(false);

  // La contraseña de sudo guardada solo se busca si de verdad hace falta (hidepid).
  useStoredSudo(sessionId, profileId, info, live && hidepid);
  const elevation = hidepid ? elev.elevation : null;
  useEffect(() => {
    setSampleElevation(sessionId, profileId, elevation);
  }, [sessionId, profileId, elevation]);
  useEffect(() => () => setSampleElevation(sessionId, profileId, null), [sessionId, profileId]);

  const scope = procScope(hidepid, myUid, mon.elevated, m.users);
  // Si el usuario elegido ya no tiene procesos, se vuelve a «todos».
  const selected = m.users.some((u) => u.uid === picked) ? picked : null;
  const procs = filterByUser(m.procs, selected);
  const selectable = m.users.filter((u) => u.uid !== null);
  const pickedUser = selected === null ? null : (m.users.find((u) => u.uid === selected) ?? null);
  const label = (u: (typeof m.users)[number]) => {
    const t = userRowText(u, { hidepid, elevated: mon.elevated });
    return t.detail ? `${t.main} · ${t.detail}` : t.main;
  };

  return (
    <>
      <section className="mon-section" aria-labelledby="mon-users-h">
        <h3 id="mon-users-h" className="section-label">
          Por usuario
        </h3>
        <div className={scope === "own" ? "mon-scope mon-scope-own" : "mon-scope"}>
          <span>{SCOPE_TEXT[scope]}</span>
          {scope === "own" && elev.canAskSudo && (
            <button className="btn btn-sm" onClick={() => setSudoOpen(true)}>
              <KeyRound size={13} /> Usar sudo
            </button>
          )}
        </div>
        <UsersSummary
          users={m.users}
          myUid={myUid}
          hidepid={hidepid}
          elevated={mon.elevated}
          selected={selected}
          onSelect={setPicked}
        />
        {pickedUser && <UserContainersNote sessionId={sessionId} user={pickedUser} myUser={mon.info?.user ?? null} myUid={myUid} />}
      </section>

      <section className="mon-section" aria-labelledby="mon-procs-h">
        <div className="mon-section-head">
          <h3 id="mon-procs-h" className="section-label">
            Procesos
          </h3>
          {selectable.length > 1 && (
            <label className="mon-proc-filter">
              <span className="muted">Usuario</span>
              <select
                className="select"
                value={selected ?? ""}
                onChange={(e) => setPicked(e.target.value === "" ? null : Number(e.target.value))}
                aria-label="Ver los procesos de"
              >
                <option value="">Todos</option>
                {selectable.map((u) => (
                  <option key={u.uid} value={u.uid ?? ""}>
                    {label(u)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <ProcessTable
          sessionId={sessionId}
          procs={procs}
          procCount={procs.length}
          sort={sort}
          onSort={onSort}
          myUid={myUid}
          myUser={mon.info?.user ?? null}
          privilege={info?.level ?? null}
          disabled={disabled}
        />
      </section>

      {sudoOpen && (
        <Suspense fallback={null}>
          <SudoDialog
            sessionId={sessionId}
            profileId={profileId}
            user={info?.user ?? null}
            reason="Para ver en el Monitor los procesos de todos los usuarios. Solo se leen, no se cambia nada."
            onClose={() => setSudoOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
