// Proyecto en el que queda el servidor.
import type { Project } from "../../api/types";

export function ProjectSelect({
  projects,
  value,
  onChange,
  onTop,
}: {
  projects: readonly Project[];
  value: string;
  onChange: (id: string) => void;
  /** Va arriba del formulario (abierto desde un proyecto). */
  onTop: boolean;
}) {
  return (
    <select className="select" value={value} aria-label="Proyecto" onChange={(e) => onChange(e.target.value)}>
      <option value="">{onTop ? "Ninguno (sin proyecto)" : "Ninguno"}</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

/** Selector arriba del todo, explicando dónde quedará el servidor nuevo. */
export function ProjectOnTop({
  projects,
  value,
  onChange,
}: {
  projects: readonly Project[];
  value: string;
  onChange: (id: string) => void;
}) {
  const chosen = projects.find((p) => p.id === value);
  return (
    <label className="field">
      <span>Proyecto</span>
      <ProjectSelect projects={projects} value={value} onChange={onChange} onTop />
      <small className="cd-field-hint">
        {chosen ? (
          <>
            Se añadirá al proyecto <strong>{chosen.name}</strong>.
          </>
        ) : (
          "No se añadirá a ningún proyecto; quedará solo en «Servidores»."
        )}
      </small>
    </label>
  );
}
