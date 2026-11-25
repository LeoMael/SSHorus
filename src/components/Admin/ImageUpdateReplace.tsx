// «Actualizar imagen» → reemplazar un contenedor creado con `run`: el formulario «Nuevo contenedor»
// relleno con lo que se copió del viejo, lo que no se pudo copiar y el script exacto.
import type { Dispatch, SetStateAction } from "react";
import type { Engine } from "../../api/vulnscan";
import type { RunForm } from "../../features/containers";
import { replaceScript, type Group } from "../../features/vulnscan";
import { RunFormFields } from "../Containers/RunFormFields";

type RunGroup = Extract<Group, { kind: "run" }>;

export function ImageUpdateReplace({
  group,
  form,
  setForm,
  warnings,
  errors,
  touched,
  engine,
  imageTags,
  lingerHint,
  howText,
  onSubmit,
}: {
  group: RunGroup;
  form: RunForm;
  setForm: Dispatch<SetStateAction<RunForm>>;
  warnings: string[];
  errors: Record<string, string>;
  touched: boolean;
  engine: Engine;
  imageTags: string[];
  lingerHint: boolean;
  howText: string;
  onSubmit: () => void;
}) {
  const c = group.container;
  return (
    <form
      className="ct-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <p className="vs-d-note">
        Revisa lo que se copió del contenedor. Al confirmar: el viejo pasa a llamarse «{c.name}-viejo» y se para; se crea el nuevo con el nombre original. Si el
        nuevo arranca bien se borra el viejo; si falla, se borra el nuevo y vuelve el viejo.
      </p>
      {warnings.length > 0 && (
        <div className="ct-warn">
          <strong>No se copia (revísalo):</strong>
          <ul className="ct-list">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <RunFormFields
        f={form}
        setF={setForm}
        engine={engine}
        errors={errors}
        touched={touched}
        imageTags={imageTags}
        volumeNames={c.mounts.filter((m) => m.type === "volume" && m.name).map((m) => m.name)}
        networkNames={c.networks}
        lingerHint={lingerHint}
        nameLocked
      />
      <div className="ct-review-label">{howText}</div>
      <pre className="ct-cmd ct-cmd-sm">{replaceScript(engine, c.name, c.running, form)}</pre>
    </form>
  );
}
