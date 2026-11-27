// Timers de systemd: cuándo se lanzan (en palabras), la próxima y la última vez, y activarlos,
// desactivarlos o ejecutar su tarea ahora.
import { timerActions, timerChange, type Timer, type TimerAction } from "../../../features/schedule";
import type { ConfigChange } from "../../../features/serverConfig";
import { useAdmin } from "../context";

const LABEL: Record<TimerAction, string> = { enable: "Activar", disable: "Desactivar", run: "Ejecutar ahora" };

export function TimersView({ timers, onChange }: { timers: Timer[]; onChange: (c: ConfigChange) => void }) {
  const { disabled } = useAdmin();
  if (!timers.length) return <div className="svc-empty">No hay timers.</div>;
  return (
    <div className="svc-scroll">
      <div className="svc-list">
        <div className="svc-item cron-timer cron-head">
          <span>Timer</span>
          <span>Cuándo</span>
          <span>Próxima vez</span>
          <span>Última vez</span>
          <span />
        </div>
        {timers.map((t) => (
          <div key={t.unit} className={`svc-item cron-timer${t.active ? "" : " svc-item-muted"}`}>
            <span className="adm-name" title={`${t.unit}${t.description ? ` · ${t.description}` : ""}${t.activates ? ` → ${t.activates}` : ""}`}>
              {t.unit.replace(/\.timer$/, "")}
              {!t.active && <span className="adm-tag svc-tag-off cron-tag">Inactivo</span>}
            </span>
            <span title={t.when}>{t.when}</span>
            <span className="faint" title={t.next ?? ""}>{t.next ?? "—"}</span>
            <span className="faint" title={t.last ?? ""}>{t.last ?? "nunca"}</span>
            <span className="svc-actions">
              {timerActions(t).map((a) => (
                <button
                  key={a}
                  className="btn btn-sm adm-row-btn"
                  disabled={disabled}
                  onClick={() => {
                    const c = timerChange(t, a);
                    if (c) onChange(c);
                  }}
                >
                  {LABEL[a]}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
