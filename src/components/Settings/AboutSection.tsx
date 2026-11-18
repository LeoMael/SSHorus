// Ajustes → Acerca de: versión, actualizaciones y novedades.
import { useState } from "react";
import { SettingGroup, SettingRow as Row, Switch as Toggle } from "../ui/SettingsKit";
import { AboutHeader, ChangelogView, UpdatesBox } from "../About/About";
import { getAutoCheck, setAutoCheck } from "../../features/updater/updater";

export function AboutSection() {
  // Se guarda en este equipo (localStorage), no en los ajustes del motor.
  const [auto, setAuto] = useState(getAutoCheck);
  return (
    <>
      <AboutHeader />
      <h4 className="st-subtitle">Actualizaciones</h4>
      <UpdatesBox />
      <SettingGroup>
        <Row label="Buscar actualizaciones automáticamente" hint="Al iniciar; si hay una nueva verás un aviso.">
          <Toggle
            checked={auto}
            onChange={(v) => {
              setAuto(v);
              setAutoCheck(v);
            }}
            label="Buscar actualizaciones automáticamente"
          />
        </Row>
      </SettingGroup>
      <h4 className="st-subtitle">Novedades</h4>
      <ChangelogView />
    </>
  );
}
