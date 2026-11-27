// Una sección plegable de «Configuración»: estado en una frase y, al abrirla, el detalle, los cambios,
// las listas y las comprobaciones de la Auditoría que le tocan (con su «Arreglar»).
import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { Check } from "../../../api/audit";
import { needsGuard } from "../../../features/audit";
import { changeFromCheck, type ConfigChange, type ConfigSection } from "../../../features/serverConfig";
import { AuditCheckRow } from "../audit/AuditCheckRow";
import { ChangeButton, Facts, Groups, StatusIcon, useCanChange } from "./ConfigParts";

const LINK_TEXT = { firewall: "Abrir el cortafuegos en el mapa", users: "Gestionar en Usuarios" } as const;

export function ConfigSectionCard({
  sec,
  onChange,
  onLink,
}: {
  sec: ConfigSection;
  onChange: (c: ConfigChange) => void;
  onLink: (to: "firewall" | "users") => void;
}) {
  const [open, setOpen] = useState(sec.status === "bad" || sec.status === "warn");
  const can = useCanChange();
  const fixCheck = (c: Check) => {
    const ch = changeFromCheck(c, needsGuard(c));
    if (ch) onChange(ch);
  };
  const id = `cf-sec-${sec.id}`;
  return (
    <section className={`cf-card cf-card-${sec.status}`}>
      <button className="cf-head" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={id}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <StatusIcon status={sec.status} />
        <span className="cf-title">{sec.title}</span>
        <span className="cf-summary">{sec.summary}</span>
      </button>
      {open && (
        <div className="cf-body" id={id}>
          <Facts facts={sec.facts} />
          {sec.notes.length > 0 && (
            <ul className="cf-notes">
              {sec.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {(sec.changes.length > 0 || sec.link) && (
            <div className="cf-actions">
              {sec.changes.map((c) => (
                <ChangeButton key={c.id} change={c} onChange={onChange} />
              ))}
              {sec.link && (
                <button className="btn btn-sm" onClick={() => onLink(sec.link!)}>
                  <ExternalLink size={12} /> {LINK_TEXT[sec.link]}
                </button>
              )}
            </div>
          )}
          <Groups groups={sec.groups} onChange={onChange} />
          {sec.checks.length > 0 && (
            <div className="cf-group">
              <div className="section-label">Comprobaciones (las mismas de la Auditoría)</div>
              {sec.checks.map((c) => (
                <AuditCheckRow key={c.id} check={c} change={null} outcome={null} fixable={can} onFix={() => fixCheck(c)} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
