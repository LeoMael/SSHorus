// Crear o editar una línea de cron: de qué usuario, cuándo (con atajos y la explicación en palabras según
// se escribe) y qué comando. Al aceptar, se enseña el cambio completo (crontab entero con copia) para
// confirmarlo.
import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { checkCommand, cronChange, describeSchedule, jobLine, SCHEDULE_PRESETS, type CronJob, type UserCrontab } from "../../../features/schedule";
import type { ConfigChange } from "../../../features/serverConfig";
import { AdmModal } from "../../ui/AdmModal";

export function CronEditDialog({
  users,
  tabs,
  edit,
  onReview,
  onClose,
}: {
  /** Usuarios que se pueden elegir (para una tarea nueva). */
  users: string[];
  tabs: UserCrontab[];
  /** La tarea a editar (null = nueva). */
  edit: { user: string; job: CronJob } | null;
  onReview: (c: ConfigChange) => void;
  onClose: () => void;
}) {
  const [user, setUser] = useState(edit?.user ?? users[0] ?? "root");
  const [schedule, setSchedule] = useState(edit?.job.schedule ?? "0 3 * * *");
  const [command, setCommand] = useState(edit?.job.command ?? "");
  const [error, setError] = useState<string | null>(null);
  const when = describeSchedule(schedule);
  const cmd = checkCommand(command);
  const ready = when.ok && cmd.ok;

  const review = () => {
    const before = tabs.find((t) => t.user === user)?.lines ?? [];
    const line = jobLine(schedule, command, edit?.job.paused ?? false);
    try {
      onReview(
        edit
          ? cronChange(user, before, { kind: "replace", index: edit.job.index, line }, `Cambiar una tarea de ${user}`, `Cambia la línea por: ${line}`)
          : cronChange(user, before, { kind: "add", line }, `Nueva tarea para ${user}`, `${when.ok ? when.text : ""}: ${command.trim()}`),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <AdmModal title={edit ? "Editar tarea programada" : "Nueva tarea programada"} onClose={onClose} width={620}>
      <div className="modal-body adm-review">
        <label className="field">
          <span>Se ejecuta como</span>
          <select className="input" value={user} onChange={(e) => setUser(e.target.value)} disabled={!!edit}>
            {users.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Cuándo (minuto hora día mes día-de-la-semana)</span>
          <div className="svc-logs-bar">
            <input className="input mono" value={schedule} onChange={(e) => setSchedule(e.target.value)} spellCheck={false} aria-label="Horario de cron" />
            <select className="input svc-scope" value="" onChange={(e) => e.target.value && setSchedule(e.target.value)} aria-label="Atajos de horario">
              <option value="">Atajos…</option>
              {SCHEDULE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </label>
        <div className={when.ok ? "au-fx-line au-fx-ok" : "au-fx-line au-fx-bad"} role="status">
          {when.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {when.ok ? when.text : when.error}
        </div>
        <label className="field">
          <span>Comando</span>
          <input className="input mono" value={command} onChange={(e) => setCommand(e.target.value)} spellCheck={false} placeholder="/usr/local/bin/copia.sh >/dev/null 2>&1" aria-label="Comando" />
        </label>
        {!cmd.ok && command && <div className="au-fx-line au-fx-bad">{cmd.error}</div>}
        {cmd.ok && cmd.warning && (
          <div className="au-fx-line au-fx-warn">
            <AlertTriangle size={13} /> {cmd.warning}
          </div>
        )}
        <div className="faint">Cron no usa tu PATH ni tu carpeta: pon rutas completas. Para no recibir correos con la salida, termina con «&gt;/dev/null 2&gt;&amp;1».</div>
        {error && <div className="adm-error" role="alert"><pre>{error}</pre></div>}
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={review} disabled={!ready}>
          Revisar el cambio <ChevronRight size={13} />
        </button>
      </div>
    </AdmModal>
  );
}
