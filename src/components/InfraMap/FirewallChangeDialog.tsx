// Cambiar el cortafuegos: abrir un puerto o servicio (formulario), quitar una regla o activarlo. Siempre
// se enseñan antes los comandos exactos y lo que protege de quedarse fuera; se aplica como tarea.
import { useState } from "react";
import { AlertTriangle, ChevronLeft, Play, ShieldCheck, Timer } from "lucide-react";
import { EMPTY_FORM, formTarget, serviceSuggestions, type RuleForm } from "../../features/infra/firewall/form";
import { lockoutProblem, sshPortsToOpen, type SshGuard } from "../../features/infra/firewall/lockout";
import { planChange, TRIAL_SECS, zoneForChange, type FwChange } from "../../features/infra/firewall/commands";
import { startFirewallChange } from "../../features/infra/firewall/job";
import { usedZones } from "../../features/infra/firewall/firewalld";
import type { FwReport, FwRule } from "../../features/infra";
import { elevationText, type Elevation } from "../../features/privileges";
import { AdmModal } from "../ui/AdmModal";
import { Segmented } from "../ui/Segmented";

export type ChangeRequest = { kind: "add" } | { kind: "remove"; rule: FwRule } | { kind: "enable" };

interface Props {
  request: ChangeRequest;
  report: FwReport;
  guard: SshGuard;
  sessionId: string;
  profileId: string;
  serverName: string;
  elevation: Elevation | null;
  onClose: () => void;
}

const TITLES: Record<ChangeRequest["kind"], string> = { add: "Abrir puerto o servicio", remove: "Quitar regla", enable: "Activar el cortafuegos" };

function RuleFormFields({ form, set, report, zone, setZone }: { form: RuleForm; set: (f: RuleForm) => void; report: FwReport; zone: string; setZone: (z: string) => void }) {
  const tool = report.tool === "ufw" ? "ufw" : "firewalld";
  const suggestions = serviceSuggestions(tool, Object.keys(report.services));
  return (
    <div className="fw-form">
      <Segmented
        label="Qué abrir"
        value={form.kind}
        onChange={(kind) => set({ ...form, kind })}
        options={[
          { value: "port", label: "Puerto" },
          { value: "service", label: tool === "ufw" ? "Aplicación" : "Servicio" },
        ]}
      />
      {form.kind === "port" ? (
        <div className="fw-form-row">
          <label className="field">
            <span>Puerto o rango</span>
            <input className="input mono" value={form.port} onChange={(e) => set({ ...form, port: e.target.value })} placeholder="443 o 8000-8010" autoFocus />
          </label>
          <Segmented
            label="Protocolo"
            value={form.proto}
            onChange={(proto) => set({ ...form, proto })}
            options={[
              { value: "tcp", label: "TCP" },
              { value: "udp", label: "UDP" },
            ]}
          />
        </div>
      ) : (
        <label className="field">
          <span>{tool === "ufw" ? "Perfil de aplicación" : "Servicio de firewalld"}</span>
          <input className="input mono" list="fw-services" value={form.service} onChange={(e) => set({ ...form, service: e.target.value })} placeholder="https" autoFocus />
          <datalist id="fw-services">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
      )}
      <label className="field">
        <span>Desde (opcional: una IP o red; vacío = desde cualquier sitio)</span>
        <input className="input mono" value={form.source} onChange={(e) => set({ ...form, source: e.target.value })} placeholder="203.0.113.4 o 10.0.0.0/8" />
      </label>
      {tool === "firewalld" && (
        <label className="field">
          <span>Zona</span>
          <select className="input" value={zone} onChange={(e) => setZone(e.target.value)}>
            {usedZones(report.zones).map((z) => (
              <option key={z.name} value={z.name}>
                {z.name} {z.interfaces.length ? `(${z.interfaces.join(", ")})` : z.isDefault ? "(por defecto)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export function FirewallChangeDialog({ request, report, guard, sessionId, profileId, serverName, elevation, onClose }: Props) {
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM);
  const [zone, setZone] = useState(() => zoneForChange(report, null, guard.conn?.serverIp ?? null) ?? "");
  const [step, setStep] = useState<"form" | "review">(request.kind === "add" ? "form" : "review");
  const [sure, setSure] = useState(false);
  const target = request.kind === "add" ? formTarget(form) : null;

  const change: FwChange | null =
    request.kind === "remove"
      ? { kind: "remove", rule: request.rule }
      : request.kind === "enable"
        ? { kind: "enable", sshPorts: sshPortsToOpen(report, guard) }
        : target && "target" in target
          ? { kind: "add", target: target.target, zone: zone || null }
          : null;
  const plan = change ? planChange(report, change, guard.conn?.serverIp ?? null) : null;
  const problem = change ? lockoutProblem(report, change, guard) : null;
  const ready = plan && !("error" in plan) ? plan : null;
  const blocked = !ready || !!problem || !elevation || (request.kind === "enable" && !sure);

  const apply = () => {
    if (!ready || !elevation) return;
    startFirewallChange({ sessionId, profileId, serverName, elevation, plan: ready });
    onClose();
  };

  return (
    <AdmModal title={TITLES[request.kind]} onClose={onClose} width={580}>
      {step === "form" ? (
        <>
          <div className="modal-body fw-dialog">
            <RuleFormFields form={form} set={setForm} report={report} zone={zone} setZone={setZone} />
            {target && "error" in target && (form.port || form.service || form.source) && <div className="field-error">{target.error}</div>}
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn btn-primary" disabled={!change} onClick={() => setStep("review")}>
              Revisar los comandos
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="modal-body fw-dialog">
            {plan && "error" in plan && (
              <div className="adm-error" role="alert">
                <AlertTriangle size={14} />
                <pre>{plan.error}</pre>
              </div>
            )}
            {ready && (
              <>
                <p className="fw-plan-title">{ready.title}</p>
                {problem && (
                  <div className="adm-error" role="alert">
                    <AlertTriangle size={14} />
                    <pre>{problem}</pre>
                  </div>
                )}
                <div className="adm-review-label">{elevationText(elevation)}</div>
                <pre className="adm-cmd" aria-label="Comandos que se ejecutarán">
                  {ready.apply.join("\n")}
                </pre>
                {ready.trial && (
                  <p className="fw-safe">
                    <Timer size={13} /> Se aplica a prueba: si en {TRIAL_SECS / 60} minutos no lo confirmas, el servidor lo deshace solo.
                    {ready.permanent.length > 0 && " Al confirmar se guarda con:"}
                  </p>
                )}
                {ready.permanent.length > 0 && <pre className="adm-cmd adm-cmd-sm">{ready.permanent.join("\n")}</pre>}
                {ready.checkLogin && (
                  <p className="fw-safe">
                    <ShieldCheck size={13} /> Después SSHorus prueba a entrar con una conexión SSH nueva; si no puede, lo deshace enseguida.
                  </p>
                )}
                <details className="fw-undo">
                  <summary>Cómo se deshace</summary>
                  <pre className="adm-cmd adm-cmd-sm">{ready.revert.join("\n")}</pre>
                </details>
                {request.kind === "enable" && (
                  <label className="checkbox">
                    <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> Sí, quiero activar el cortafuegos (el puerto de SSH
                    queda abierto).
                  </label>
                )}
                {!elevation && <div className="field-error">Hace falta sudo para cambiar el cortafuegos.</div>}
              </>
            )}
          </div>
          <div className="modal-footer">
            {request.kind === "add" && (
              <button className="btn adm-footer-left" onClick={() => setStep("form")}>
                <ChevronLeft size={14} /> Volver
              </button>
            )}
            <button className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button className={request.kind === "add" ? "btn btn-primary" : "btn btn-danger"} onClick={apply} disabled={blocked} autoFocus={request.kind !== "enable"}>
              <Play size={13} /> Aplicar
            </button>
          </div>
        </>
      )}
    </AdmModal>
  );
}
