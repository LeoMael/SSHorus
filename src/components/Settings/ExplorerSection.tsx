// Ajustes → Explorador: archivos ocultos y confirmación al borrar.
import { SettingGroup, SettingRow as Row, Switch as Toggle } from "../ui/SettingsKit";
import { useSetting } from "./useSetting";

export function ExplorerSection() {
  const [hidden, setHidden] = useSetting("showHiddenFiles");
  const [confirmDel, setConfirmDel] = useSetting("confirmDelete");
  return (
    <>
      <SettingGroup>
        <Row label="Mostrar archivos ocultos" hint="Los que empiezan por un punto (.env, .git…).">
          <Toggle checked={hidden} onChange={setHidden} label="Mostrar archivos ocultos" />
        </Row>
        <Row label="Confirmar antes de borrar">
          <Toggle checked={confirmDel} onChange={setConfirmDel} label="Confirmar antes de borrar" />
        </Row>
      </SettingGroup>
    </>
  );
}
