// Ajustes → Transferencias: cuántas a la vez y qué hacer si el archivo ya existe.
import type { Settings } from "../../api/types";
import { Segmented, SettingGroup, SettingRow as Row } from "../ui/SettingsKit";
import { useSetting } from "./useSetting";

const CONFLICT_HINTS: Record<Settings["transferConflict"], string> = {
  overwrite: "Reemplaza siempre el de destino.",
  skip: "No transfiere los que ya existen.",
  newer: "Reemplaza solo si el origen es más reciente.",
  ask: "Pregunta archivo por archivo.",
};

export function TransfersSection() {
  const [conc, setConc] = useSetting("transferConcurrency");
  const [conflict, setConflict] = useSetting("transferConflict");
  return (
    <>
      <SettingGroup>
        <Row label="Transferencias simultáneas" hint="Más no siempre es más rápido.">
          <div className="st-range">
            <input
              type="range"
              min={1}
              max={8}
              step={1}
              value={conc}
              onChange={(e) => setConc(Number(e.target.value))}
              aria-label="Transferencias simultáneas"
            />
            <span className="st-range-value">{conc}</span>
          </div>
        </Row>
        <Row label="Si el archivo ya existe" hint={CONFLICT_HINTS[conflict]}>
          <Segmented
            value={conflict}
            label="Si el archivo ya existe"
            onChange={setConflict}
            options={[
              { v: "overwrite", label: "Sobrescribir", title: CONFLICT_HINTS.overwrite },
              { v: "skip", label: "Omitir", title: CONFLICT_HINTS.skip },
              { v: "newer", label: "Solo si es más nuevo", title: CONFLICT_HINTS.newer },
              { v: "ask", label: "Preguntar", title: CONFLICT_HINTS.ask },
            ]}
          />
        </Row>
      </SettingGroup>
    </>
  );
}
