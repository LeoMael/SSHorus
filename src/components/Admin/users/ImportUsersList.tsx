// Lista con casillas de los usuarios del servidor para «Añadir a SSHorus».
// Usuarios normales arriba, root aparte (sin marcar) y las cuentas del sistema solo si se piden (sin casilla).
// Debajo de cada usuario elegido van sus opciones (nombre y cómo entra), que pinta `renderOptions`.
import type { ReactNode } from "react";
import type { ImportCandidate } from "../../../features/admin";
import { AccountTag } from "./AccountTag";

function keysCell(c: ImportCandidate): ReactNode {
  if (c.keys === null) return <span className="faint" title="No se pudo leer">—</span>;
  if (c.keys === 0) return <span className="faint">Ninguna</span>;
  return <span className="adm-tag adm-tag-accent">{c.keys}</span>;
}

interface RowProps {
  selected: Set<string>;
  onToggle: (name: string) => void;
  renderOptions: (c: ImportCandidate) => ReactNode;
}

function Row({ c, selected, onToggle, renderOptions }: RowProps & { c: ImportCandidate }) {
  const disabled = c.blocked !== null;
  const checked = selected.has(c.name);
  return (
    <div className={`iu-item${checked && !disabled ? " iu-item-on" : ""}`}>
      <label className={`iu-row${disabled ? " iu-row-off" : ""}`} title={c.blocked ?? undefined}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggle(c.name)} aria-label={`Añadir ${c.name}`} />
        <span className="iu-user">
          <span className="adm-name">{c.name}</span>
          {c.fullName && <span className="faint iu-full">{c.fullName}</span>}
        </span>
        <span>{keysCell(c)}</span>
        <span>
          <AccountTag state={c.account} />
        </span>
        <span>{c.sudo ? <span className="adm-tag adm-tag-accent">Sí</span> : <span className="faint">No</span>}</span>
        <span className="iu-note">{c.existing ? <span className="adm-tag adm-tag-yellow">Ya en SSHorus</span> : c.blocked && <span className="faint">{c.blocked}</span>}</span>
      </label>
      {checked && !disabled && renderOptions(c)}
    </div>
  );
}

function Section({ label, list, ...rest }: RowProps & { label: string; list: ImportCandidate[] }) {
  if (!list.length) return null;
  return (
    <>
      <div className="section-label iu-section">{label}</div>
      {list.map((c) => (
        <Row key={c.name} c={c} {...rest} />
      ))}
    </>
  );
}

export function ImportUsersList({ candidates, showSystem, ...rest }: RowProps & { candidates: ImportCandidate[]; showSystem: boolean }) {
  const users = candidates.filter((c) => c.kind === "user");
  const root = candidates.filter((c) => c.kind === "root");
  const system = showSystem ? candidates.filter((c) => c.kind === "system") : [];
  return (
    <div className="iu-list" role="group" aria-label="Usuarios del servidor">
      <div className="iu-row iu-head" aria-hidden>
        <span />
        <span>Usuario</span>
        <span>Llaves autorizadas</span>
        <span>Cuenta</span>
        <span>Sudo</span>
        <span />
      </div>
      {!users.length && <div className="faint iu-empty">No hay usuarios normales que puedan entrar.</div>}
      <Section label="Usuarios" list={users} {...rest} />
      <Section label="Administrador" list={root} {...rest} />
      <Section label="Cuentas del sistema" list={system} {...rest} />
    </div>
  );
}
