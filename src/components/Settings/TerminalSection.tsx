// Ajustes → Terminal: letra (con vista previa), aceleración por GPU y tmux.
import { useMemo, useState } from "react";
import { NumberStepper, Segmented, SettingGroup, SettingRow as Row, Switch as Toggle } from "../ui/SettingsKit";
import { DEFAULT_SETTINGS, useSettings } from "../../stores/settings";
import { getTerminalGpu, setTerminalGpu } from "../Terminal/gpuPref";
import { buildTermTheme } from "../Terminal/termTheme";
import { TMUX_MODE_HINTS, TMUX_MODE_LABELS } from "../../features/tmux/logic";
import { useAppTheme } from "../../stores/appTheme";
import { FontFamilyInput } from "./FontFamilyInput";
import { useSetting } from "./useSetting";
import { setTerminalLogAll, useTerminalLogPrefs } from "../../features/serverHistory/prefs";

/** Colores de la terminal con la apariencia actual (para la vista previa). */
function useTermColors() {
  const palette = useAppTheme((s) => s.palette);
  const accent = useSettings((s) => s.settings.accent);
  // buildTermTheme lee las variables de <html>, ya actualizadas cuando cambian palette o accent.
  return useMemo(() => (void palette, void accent, buildTermTheme()), [palette, accent]);
}

export function TerminalSection() {
  const [size, setSize] = useSetting("terminalFontSize");
  const [family, setFamily] = useSetting("terminalFontFamily");
  const [tmux, setTmux] = useSetting("terminalTmux");
  // Se guarda en este equipo (localStorage), no en los ajustes del motor.
  const [gpu, setGpu] = useState(getTerminalGpu);
  const tc = useTermColors();
  const termLog = useTerminalLogPrefs();
  return (
    <>
      <SettingGroup title="Letra">
        <Row label="Tamaño de letra">
          <NumberStepper value={size} min={8} max={32} suffix="px" onChange={setSize} />
        </Row>
        <Row label="Tipo de letra" hint="Se usa la primera fuente instalada.">
          <FontFamilyInput value={family} onChange={setFamily} fallback={DEFAULT_SETTINGS.terminalFontFamily} />
        </Row>
        <div className="st-preview" style={{ fontFamily: family, fontSize: size, background: tc.background, color: tc.foreground }}>
          <span style={{ color: tc.green }}>deploy@web-prod</span>:<span style={{ color: tc.blue }}>~/app</span>$ ls -la
          <br />
          drwxr-xr-x 4 deploy deploy 4096 <span style={{ color: tc.blue }}>public</span>  0O1lI|
        </div>
      </SettingGroup>
      <SettingGroup title="Funcionamiento">
        <Row label="Aceleración por GPU en la terminal" hint="Desactívala si ves fallos de dibujado.">
          <Toggle
            checked={gpu}
            onChange={(v) => {
              setGpu(v);
              setTerminalGpu(v);
            }}
            label="Aceleración por GPU en la terminal"
          />
        </Row>
        <Row label="Terminales persistentes (tmux)" hint="Lo que corre sigue vivo si se corta la conexión.">
          <Segmented
            value={tmux}
            label="Terminales persistentes (tmux)"
            onChange={setTmux}
            options={(["auto", "always", "never"] as const).map((v) => ({
              v,
              label: TMUX_MODE_LABELS[v],
              title: `${TMUX_MODE_HINTS[v]} Cada servidor puede cambiarlo en su ficha.`,
            }))}
          />
        </Row>
      </SettingGroup>
      <SettingGroup title="Historial por servidor">
        <Row
          label="Guardar los comandos que escribo en la terminal"
          hint="En todos los servidores (o solo en algunos, desde «Historial…» del servidor). Se guarda en este equipo; nunca lo escrito tras un aviso de contraseña, y las contraseñas guardadas y las llaves se tapan. Puede contener datos sensibles."
        >
          <Toggle checked={termLog.all} onChange={setTerminalLogAll} label="Guardar los comandos que escribo en la terminal" />
        </Row>
      </SettingGroup>
    </>
  );
}
