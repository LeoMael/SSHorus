// Ajustes → Apariencia: tema, color de acento y tamaño de la letra de la interfaz.
import type { ReactNode } from "react";
import { Check, Monitor } from "lucide-react";
import { Segmented, SettingGroup, SettingRow as Row } from "../ui/SettingsKit";
import { ACCENTS, PALETTES, type AccentId, type PaletteInfo, type ThemeId } from "../../styles/themes";
import { useAppTheme } from "../../stores/appTheme";
import { useSetting } from "./useSetting";

/** Miniatura de una apariencia: barra lateral, panel con acento y un trozo de terminal. */
function ThemeThumb({ p }: { p: PaletteInfo["preview"] }) {
  return (
    <span className="st-thumb" style={{ background: p.bg, borderColor: p.border }} aria-hidden>
      <span className="st-thumb-side" style={{ background: p.sunken, borderColor: p.border }}>
        <i style={{ background: p.accent }} />
        <i style={{ background: p.muted }} />
        <i style={{ background: p.muted }} />
      </span>
      <span className="st-thumb-main">
        <span className="st-thumb-bar" style={{ background: p.surface, borderColor: p.border }}>
          <i style={{ background: p.text }} />
          <b style={{ background: p.accent }} />
        </span>
        <span className="st-thumb-term" style={{ background: p.terminal, borderColor: p.border }}>
          <i style={{ background: p.termText }} />
          <i style={{ background: p.muted, width: "70%" }} />
          <i style={{ background: p.muted, width: "45%" }} />
        </span>
      </span>
    </span>
  );
}

export function AppearanceSection() {
  const [theme, setTheme] = useSetting("theme");
  const [accent, setAccent] = useSetting("accent");
  const [uiSize, setUiSize] = useSetting("uiFontSize");
  const mode = useAppTheme((s) => s.theme);
  const dark = PALETTES.find((p) => p.id === "dark")!;
  const light = PALETTES.find((p) => p.id === "light")!;
  const cards: { id: ThemeId; label: string; hint: string; thumb: ReactNode }[] = [
    {
      id: "system",
      label: "Sistema",
      hint: "Claro u Oscuro según el modo de tu equipo.",
      thumb: (
        <span className="st-thumb-split">
          <ThemeThumb p={light.preview} />
          <ThemeThumb p={dark.preview} />
        </span>
      ),
    },
    ...PALETTES.map((p) => ({ id: p.id, label: p.label, hint: p.hint, thumb: <ThemeThumb p={p.preview} /> })),
  ];
  return (
    <>
      <SettingGroup title="Tema">
        <div className="st-themes" role="radiogroup" aria-label="Tema">
          {cards.map((c) => (
            <button
              type="button"
              key={c.id}
              role="radio"
              aria-checked={theme === c.id}
              className={theme === c.id ? "st-theme active" : "st-theme"}
              onClick={() => setTheme(c.id)}
            >
              {c.thumb}
              <span className="st-theme-name">
                {c.id === "system" && <Monitor size={13} />}
                {c.label}
                {theme === c.id && <Check size={14} className="st-theme-check" />}
              </span>
              <span className="st-theme-hint">{c.hint}</span>
            </button>
          ))}
        </div>
      </SettingGroup>
      <SettingGroup title="Detalles">
        <Row label="Color de acento" hint="«Del tema» usa el de cada apariencia.">
          <div className="st-swatches" role="radiogroup" aria-label="Color de acento">
            <button
              type="button"
              role="radio"
              aria-checked={!accent}
              className={!accent ? "st-swatch st-swatch-auto active" : "st-swatch st-swatch-auto"}
              onClick={() => setAccent("")}
            >
              Del tema
            </button>
            {ACCENTS.map((a) => (
              <button
                type="button"
                key={a.id}
                role="radio"
                aria-checked={accent === a.id}
                aria-label={a.label}
                title={a.label}
                className={accent === a.id ? "st-swatch active" : "st-swatch"}
                style={{ background: mode === "dark" ? a.dark : a.light }}
                onClick={() => setAccent(a.id as AccentId)}
              >
                {accent === a.id && <Check size={13} />}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Tamaño de la letra de la interfaz" hint="La terminal y el editor tienen su propio tamaño.">
          <Segmented
            value={uiSize}
            label="Tamaño de la letra de la interfaz"
            onChange={setUiSize}
            options={[
              { v: 12, label: "Pequeña" },
              { v: 13, label: "Normal" },
              { v: 14, label: "Grande" },
              { v: 15, label: "Muy grande" },
            ]}
          />
        </Row>
      </SettingGroup>
    </>
  );
}
