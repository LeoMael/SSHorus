// Ejecuta un cambio de Administración como root: lo apunta en el historial (sin contraseñas), avisa del
// resultado y vuelve a leer el servidor.
import { useCallback } from "react";
import { errorMessage } from "../../api/core";
import { runPlan as execPlan, useAdminHistory, type Plan } from "../../features/admin";
import { historyCommand } from "../../features/admin/historyCommand";
import { ElevationError, failureText, refreshPrivilege, succeeded, sudoRejected, type Elevation } from "../../features/privileges";
import { toast } from "../../stores/toasts";
import type { RunOutcome } from "./context";

export function useAdminRunPlan(o: {
  sessionId: string;
  profileId: string;
  serverName: string;
  disabled: boolean;
  elevation: Elevation | null;
  canAskSudo: boolean;
  reload: () => Promise<void>;
}) {
  const { sessionId, profileId, serverName, disabled, elevation, canAskSudo, reload } = o;
  const addHistory = useAdminHistory((s) => s.add);
  return useCallback(
    async (plan: Plan, opts?: { refresh?: boolean }): Promise<RunOutcome> => {
      if (disabled) return { ok: false, result: null, error: "Sin conexión con el servidor", needSudo: false };
      if (!elevation) {
        return { ok: false, result: null, error: "Necesitas root o sudo para hacer cambios", needSudo: canAskSudo };
      }
      const command = historyCommand(plan, elevation);
      try {
        const r = await execPlan(sessionId, plan, elevation);
        const ok = succeeded(r);
        const text = ok ? r.stdout.trim() || r.stderr.trim() || "Correcto" : failureText(r);
        addHistory(profileId, { server: serverName, action: plan.action, command, ok, result: text });
        if (ok) toast.success(plan.action, "Hecho");
        else toast.error(`No se pudo: ${plan.action}`, text);
        if (opts?.refresh !== false) void reload();
        return { ok, result: r, error: ok ? null : text, needSudo: false };
      } catch (e) {
        const msg = errorMessage(e);
        addHistory(profileId, { server: serverName, action: plan.action, command, ok: false, result: msg });
        toast.error(`No se pudo: ${plan.action}`, msg);
        if (e instanceof ElevationError) {
          if (e.failure === "need-password") refreshPrivilege(sessionId);
          if (e.failure === "bad-password") sudoRejected(sessionId);
          return { ok: false, result: null, error: msg, needSudo: e.failure === "bad-password" || e.failure === "need-password" };
        }
        return { ok: false, result: null, error: msg, needSudo: false };
      }
    },
    [disabled, elevation, canAskSudo, sessionId, profileId, serverName, addHistory, reload],
  );
}
