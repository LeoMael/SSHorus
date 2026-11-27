// «Ver» del aviso de la auditoría programada: qué empeoró (y qué mejoró) en cada servidor frente a su
// auditoría anterior. «Abrir en Administración» lleva al informe completo, con «Arreglar» y el historial.
import { ArrowRight, ExternalLink } from "lucide-react";
import { STATUS_TEXT, closeAuditChanges, type CheckChange, type ServerChange } from "../../features/audit";
import { useProfiles } from "../../stores/profiles";
import { AdmModal } from "../ui/AdmModal";
import { openServerAudit } from "./openServerAudit";
import "../Admin/audit/Audit.css";
import "./ProjectAudit.css";

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
}

function ChangeList({ label, list }: { label: string; list: CheckChange[] }) {
  if (!list.length) return null;
  return (
    <>
      <div className="pa-chg-label">{label}</div>
      {list.map((c) => (
        <div key={c.id} className={`pa-chg-row au-${c.to}`}>
          <span className="au-title">{c.title}</span>
          <span className="pa-chg-status">
            {c.from ? STATUS_TEXT[c.from] : "No salía"}
            <ArrowRight size={11} aria-label="pasa a" />
            {STATUS_TEXT[c.to]}
          </span>
        </div>
      ))}
    </>
  );
}

function ServerBlock({ change }: { change: ServerChange }) {
  const server = useProfiles((s) => s.servers.find((x) => x.id === change.profileId) ?? null);
  const d = change.diff;
  const open = () => {
    if (!server) return;
    closeAuditChanges();
    void openServerAudit(server);
  };
  return (
    <div className="pa-chg">
      <div className="pa-chg-head">
        <strong>{change.name}</strong>
        <span className="faint">
          {d.scoreBefore ?? "—"} → {d.scoreAfter ?? "—"}/100 · frente al {when(d.previousAt)}
        </span>
        <span className="pa-spacer" />
        <button className="btn btn-sm" onClick={open} disabled={!server} title="Su informe completo, con «Arreglar» y el historial">
          <ExternalLink size={12} /> Abrir en Administración
        </button>
      </div>
      {d.sudoChanged && <div className="faint pa-hint">Una de las dos auditorías se hizo sin sudo: la nota no se compara.</div>}
      <ChangeList label="Empeora" list={d.worse} />
      <ChangeList label="Problemas nuevos" list={d.appeared} />
      <ChangeList label="Mejora" list={d.better} />
    </div>
  );
}

export function AuditChangesDialog({ changes }: { changes: ServerChange[] }) {
  return (
    <AdmModal title="Auditoría programada · qué cambió" onClose={closeAuditChanges} width="min(720px, 94vw)">
      <div className="modal-body pa-body">
        {changes.map((c) => (
          <ServerBlock key={c.profileId} change={c} />
        ))}
      </div>
      <div className="modal-footer">
        <button className="btn btn-primary" onClick={closeAuditChanges}>
          Cerrar
        </button>
      </div>
    </AdmModal>
  );
}
