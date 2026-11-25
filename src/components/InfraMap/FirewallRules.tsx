// Lista de reglas del cortafuegos: una frase por regla (clic = la regla original) agrupadas por zona o
// cadena, con «Quitar» cuando SSHorus sabe hacerlo sin dejarte fuera.
import { useState, type ComponentType } from "react";
import { Ban, Check, ChevronRight, CornerDownRight, FileText, Gauge, Minus, Shuffle, Trash2, type LucideProps } from "lucide-react";
import { ruleText, type FwReport, type FwRule, type FwVerdict } from "../../features/infra/firewall";

const VERDICT_ICON: Record<FwVerdict, ComponentType<LucideProps>> = {
  allow: Check,
  limit: Gauge,
  deny: Ban,
  reject: Ban,
  jump: CornerDownRight,
  return: CornerDownRight,
  nat: Shuffle,
  log: FileText,
  other: Minus,
};

export interface RuleActions {
  /** Motivo por el que no se puede quitar (null = se puede; undefined = no se ofrece). */
  removeBlock: (r: FwRule) => string | null | undefined;
  onRemove: (r: FwRule) => void;
}

function RuleRow({ rule, report, actions }: { rule: FwRule; report: FwReport; actions: RuleActions | null }) {
  const [open, setOpen] = useState(false);
  const Icon = VERDICT_ICON[rule.verdict];
  const block = actions?.removeBlock(rule);
  const text = ruleText(rule, report);
  return (
    <li className={`fw-rule fw-v-${rule.verdict}`}>
      <div className="fw-rule-line">
        <button className="fw-rule-main" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Ver la regla original">
          <ChevronRight size={12} className={`fw-chev${open ? " open" : ""}`} />
          <Icon size={13} className="fw-verdict" />
          <span className="fw-rule-text">
            {text}
            {rule.comment && <span className="fw-comment"> · {rule.comment}</span>}
          </span>
        </button>
        {block !== undefined && (
          <button
            className="icon-btn fw-remove"
            onClick={() => actions?.onRemove(rule)}
            disabled={block !== null}
            title={block ?? "Quitar esta regla…"}
            aria-label={`Quitar: ${text}`}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {open && (
        <pre className="fw-raw">
          {rule.raw}
          {"\n"}
          <span className="faint">en {rule.place}</span>
        </pre>
      )}
    </li>
  );
}

/** Reglas agrupadas por su zona o cadena (en ufw hay un solo grupo, sin título). */
export function FirewallRules({ rules, report, actions }: { rules: FwRule[]; report: FwReport; actions: RuleActions | null }) {
  const groups = new Map<string, FwRule[]>();
  for (const r of rules) groups.set(r.place, [...(groups.get(r.place) ?? []), r]);
  const titled = report.tool !== "ufw" || groups.size > 1;
  return (
    <div className="fw-groups">
      {[...groups].map(([place, list]) => (
        <section key={place} className="fw-group" aria-label={place}>
          {titled && <h4 className="fw-group-title">{report.tool === "firewalld" ? `Zona «${place}»` : place}</h4>}
          <ul className="fw-rules">
            {list.map((r) => (
              <RuleRow key={r.id} rule={r} report={report} actions={actions} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
