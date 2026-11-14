// Lista con casillas de los usuarios del servidor para «Añadir a SSHorus».
// Usuarios normales arriba, root aparte (sin marcar) y las cuentas del sistema solo si se piden (sin casilla).
import type { ReactNode } from "react";
import type { ImportCandidate, PasswordState } from "../../features/admin";

const PASSWORD: Record<PasswordState, { text: string; cls: string; title: string }> = {
  active: { text: "Activa", cls: "adm-tag adm-tag-green", title: "Puede entrar con contraseña" },
  locked: { text: "Bloqueada", cls: "adm-tag adm-tag-red", title: "La contraseña está bloqueada" },
  empty: { text: "Vacía", cls: "adm-tag adm-tag-yellow", title: "Contraseña vacía: sshd no la acepta" },
  none: { text: "Sin contraseña", cls: "faint", title: "Solo puede entrar con llave" },
  unknown: { text: "—", cls: "faint", title: "No se pudo saber" },
};

function keysCell(c: ImportCandidate): ReactNode {
  if (c.keys === null) return <span className="faint" title="No se pudo leer">—</span>;
  if (c.keys === 0) return <span className="faint">Ninguna</span>;
  return <span className="adm-tag adm-tag-accent">{c.keys}</span>;
}

function Row({ c, checked, onToggle }: { c: ImportCandidate; checked: boolean; onToggle: (name: string) => void }) {
  const pw = PASSWORD[c.password];
  const disabled = c.blocked !== null;
  return (
    <label className={`iu-row${disabled ? " iu-row-off" : ""}`} title={c.blocked ?? undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggle(c.name)} aria-label={`Añadir ${c.name}`} />
      <span className="iu-user">
        <span className="adm-name">{c.name}</span>
        {c.fullName && <span className="faint iu-full">{c.fullName}</span>}
      </span>
      <span>{keysCell(c)}</span>
      <span className={pw.cls} title={pw.title}>
        {pw.text}
      </span>
      <span>{c.sudo ? <span className="adm-tag adm-tag-accent">Sí</span> : <span className="faint">No</span>}</span>
      <span className="iu-note">{c.existing ? <span className="adm-tag adm-tag-yellow">Ya en SSHorus</span> : c.blocked && <span className="faint">{c.blocked}</span>}</span>
    </label>
  );
}

function Section({ label, list, ...rest }: { label: string; list: ImportCandidate[]; selected: Set<string>; onToggle: (n: string) => void }) {
  if (!list.length) return null;
  return (
    <>
      <div className="section-label iu-section">{label}</div>
      {list.map((c) => (
        <Row key={c.name} c={c} checked={rest.selected.has(c.name)} onToggle={rest.onToggle} />
      ))}
    </>
  );
}

export function ImportUsersList({
  candidates,
  selected,
  onToggle,
  showSystem,
}: {
  candidates: ImportCandidate[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  showSystem: boolean;
}) {
  const users = candidates.filter((c) => c.kind === "user");
  const root = candidates.filter((c) => c.kind === "root");
  const system = showSystem ? candidates.filter((c) => c.kind === "system") : [];
  return (
    <div className="iu-list" role="group" aria-label="Usuarios del servidor">
      <div className="iu-row iu-head" aria-hidden>
        <span />
        <span>Usuario</span>
        <span>Llaves</span>
        <span>Contraseña</span>
        <span>Sudo</span>
        <span />
      </div>
      {!users.length && <div className="faint iu-empty">No hay usuarios normales que puedan entrar.</div>}
      <Section label="Usuarios" list={users} selected={selected} onToggle={onToggle} />
      <Section label="Administrador" list={root} selected={selected} onToggle={onToggle} />
      <Section label="Cuentas del sistema" list={system} selected={selected} onToggle={onToggle} />
    </div>
  );
}
