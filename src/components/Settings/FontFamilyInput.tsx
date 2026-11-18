// Campo «Tipo de letra» con fuentes monoespaciadas habituales como sugerencias.
import { DEFAULT_MONO_FONT } from "../../stores/settings";

const FONT_PRESETS = [
  DEFAULT_MONO_FONT,
  "'Fira Code', monospace",
  "'Cascadia Code', 'Cascadia Mono', monospace",
  "'Source Code Pro', monospace",
  "'Ubuntu Mono', monospace",
  "'DejaVu Sans Mono', monospace",
  "Menlo, Monaco, monospace",
  "Consolas, 'Courier New', monospace",
  "monospace",
];

export function FontFamilyInput({ value, onChange, fallback }: { value: string; onChange: (v: string) => void; fallback: string }) {
  return (
    <>
      <input
        className="input st-wide mono"
        value={value}
        list="st-font-presets"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => !e.target.value.trim() && onChange(fallback)}
      />
      <datalist id="st-font-presets">
        {FONT_PRESETS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </>
  );
}
