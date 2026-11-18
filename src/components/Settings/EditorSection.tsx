// Ajustes → Editor: cómo se abren los archivos, tamaño máximo y letra (con vista previa).
import { useState } from "react";
import { AppWindow, Columns2, PanelTop } from "lucide-react";
import { NumberStepper, Segmented, SettingGroup, SettingRow as Row } from "../ui/SettingsKit";
import { DEFAULT_SETTINGS } from "../../stores/settings";
import { getEditorOpenMode, setEditorOpenMode, type EditorOpenMode } from "../Editor/openPref";
import { useShortcutText } from "../../features/shortcuts/shortcuts";
import { FontFamilyInput } from "./FontFamilyInput";
import { useSetting } from "./useSetting";

const MB = 1024 * 1024;

export function EditorSection() {
  const [maxBytes, setMaxBytes] = useSetting("editorMaxBytes");
  const [size, setSize] = useSetting("editorFontSize");
  const [family, setFamily] = useSetting("editorFontFamily");
  const splitKeys = useShortcutText("session.split");
  const mb = Math.max(1, Math.round(maxBytes / MB));
  const [openMode, setOpenModeState] = useState<EditorOpenMode>(getEditorOpenMode);
  const setOpenMode = (m: EditorOpenMode) => {
    setEditorOpenMode(m);
    setOpenModeState(m);
  };
  return (
    <>
      <SettingGroup title="Archivos">
        <Row label="Al abrir un archivo" hint={splitKeys ? `${splitKeys} divide o quita la división.` : undefined}>
          <Segmented
            value={openMode}
            label="Al abrir un archivo"
            onChange={setOpenMode}
            options={[
              { v: "tab", label: "Pestaña", icon: <PanelTop size={14} /> },
              { v: "split", label: "Dividido", icon: <Columns2 size={14} /> },
              { v: "window", label: "En ventana aparte", icon: <AppWindow size={14} /> },
            ]}
          />
        </Row>
        <Row label="Tamaño máximo para abrir" hint="Los más grandes se pueden descargar.">
          <NumberStepper value={mb} min={1} max={100} suffix="MB" onChange={(v) => setMaxBytes(v * MB)} />
        </Row>
      </SettingGroup>
      <SettingGroup title="Letra">
        <Row label="Tamaño de letra">
          <NumberStepper value={size} min={8} max={32} suffix="px" onChange={setSize} />
        </Row>
        <Row label="Tipo de letra" hint="Se usa la primera fuente instalada.">
          <FontFamilyInput value={family} onChange={setFamily} fallback={DEFAULT_SETTINGS.editorFontFamily} />
        </Row>
        <div className="st-preview st-preview-editor" style={{ fontFamily: family, fontSize: size }}>
          <span className="st-kw">server</span> {"{"}
          <br />
          &nbsp;&nbsp;listen <span className="st-numlit">443</span> ssl; <span className="st-comment"># 0O1lI|</span>
          <br />
          {"}"}
        </div>
      </SettingGroup>
    </>
  );
}
