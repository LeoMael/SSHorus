// Ajustes → Conexión: detección de cortes y reconexión automática.
import { NumberStepper, Segmented, SettingGroup, SettingRow as Row, Switch as Toggle } from "../ui/SettingsKit";
import { useSetting } from "./useSetting";

const KEEPALIVE_OPTIONS = [5, 10, 20, 30, 60];

export function ConnectionSection() {
  const [keepalive, setKeepalive] = useSetting("keepaliveSecs");
  const [auto, setAuto] = useSetting("autoReconnect");
  const [attempts, setAttempts] = useSetting("reconnectAttempts");
  const values = KEEPALIVE_OPTIONS.includes(keepalive) ? KEEPALIVE_OPTIONS : [...KEEPALIVE_OPTIONS, keepalive].sort((a, b) => a - b);
  return (
    <>
      <SettingGroup>
        <Row label="Detectar desconexión en" hint={`Se da por perdida tras ≈ ${keepalive * 3} s sin respuesta.`}>
          <Segmented
            value={keepalive}
            label="Detectar desconexión en"
            onChange={setKeepalive}
            options={values.map((v) => ({ v, label: `${v} s` }))}
          />
        </Row>
        <Row label="Reconectar automáticamente" hint="Con la contraseña o frase guardada.">
          <Toggle checked={auto} onChange={setAuto} label="Reconectar automáticamente" />
        </Row>
        <Row label="Intentos">
          <div className={auto ? undefined : "st-disabled"}>
            <NumberStepper value={attempts} min={1} max={20} onChange={setAttempts} />
          </div>
        </Row>
      </SettingGroup>
    </>
  );
}
