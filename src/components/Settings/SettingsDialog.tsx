// Ajustes de la app. Los cambios se aplican al momento (useSettings().update guarda con retardo).
// Navegación lateral agrupada con buscador, cabecera de sección y filas en tarjetas (ui/SettingsKit).
// Cada sección vive en su archivo; la lista está en settingsSections.tsx.
import { useMemo, useRef, useState } from "react";
import { RotateCcw, Search, X } from "lucide-react";
import { Modal } from "../ui/Modal";
// Antes que SettingsDialog.css, que ajusta algunas de sus reglas.
import "../ui/SettingsKit";
import { useUi } from "../../stores/ui";
import { DEFAULT_SETTINGS, useSettings } from "../../stores/settings";
import { confirmDialog } from "../ui/dialogs";
import "./SettingsDialog.css";
import "./SettingsAppearance.css";
import "./SettingsNarrow.css";
import { useSettingsNav, type SectionId } from "./settingsNav";
import { filterNav } from "./settingsSearch";
import { ALL_SECTIONS, NAV } from "./settingsSections";

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  const close = useUi((s) => s.closeSettings);
  if (!open) return null;
  return (
    <Modal
      open
      title="Ajustes"
      onClose={close}
      className="st-modal"
      // Ancha para que quepan las secciones largas (MCP, terminal local e IA); en pantallas pequeñas,
      // como mucho el 94 % de la ventana.
      width="min(1080px, 94vw)"
      footer={
        <>
          <button className="btn st-reset" onClick={() => void resetAll()}>
            <RotateCcw size={14} /> Restablecer
          </button>
          <span className="st-footer-hint">Los cambios se guardan solos.</span>
          <button className="btn btn-primary" onClick={close} autoFocus>
            Listo
          </button>
        </>
      }
    >
      <SettingsBody />
    </Modal>
  );
}

function SettingsBody() {
  const section = useSettingsNav((s) => s.section);
  const setSection = useSettingsNav((s) => s.setSection);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => filterNav(NAV, query), [query]);
  const current = ALL_SECTIONS.find((s) => s.id === section) ?? ALL_SECTIONS[0];
  const View = current.view;
  const go = (id: SectionId) => {
    setSection(id);
    contentRef.current?.scrollTo({ top: 0 });
  };

  return (
    <div className="st-root">
      <nav className="st-nav" aria-label="Secciones de ajustes">
        <div className="st-search">
          <Search size={14} aria-hidden />
          <input
            ref={searchRef}
            className="st-search-input"
            placeholder="Buscar ajuste…"
            value={query}
            aria-label="Buscar ajuste"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && groups[0]) go(groups[0].items[0].id);
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                setQuery("");
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="st-search-clear"
              aria-label="Borrar búsqueda"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>
        <div className="st-nav-list">
          {groups.map((g) => (
            <div className="st-nav-group" key={g.group}>
              <div className="st-nav-group-title">{g.group}</div>
              {g.items.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className={section === s.id ? "st-nav-item active" : "st-nav-item"}
                  onClick={() => go(s.id)}
                  aria-current={section === s.id ? "page" : undefined}
                  title={s.label}
                >
                  {s.icon}
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && <div className="st-nav-empty">Sin resultados para «{query.trim()}».</div>}
        </div>
      </nav>
      <div className="st-main" ref={contentRef}>
        {!current.bare && (
          <header className="st-head">
            <span className="st-head-icon" aria-hidden>
              {current.icon}
            </span>
            <div>
              <h3 className="st-head-title">{current.label}</h3>
              <p className="st-head-desc">{current.desc}</p>
            </div>
          </header>
        )}
        <div className={`st-body st-body-${section}`}>
          <View />
        </div>
      </div>
    </div>
  );
}

async function resetAll() {
  const ok = await confirmDialog({
    title: "Restablecer ajustes",
    message: "Se volverán a los valores de fábrica (el tamaño de los paneles no cambia).",
    confirmText: "Restablecer",
  });
  if (!ok) return;
  // «Ahora no» al PIN se respeta: restablecer no vuelve a mostrar la pantalla de crear PIN.
  const { layout: _layout, vaultPromptDismissed: _dismissed, ...defaults } = DEFAULT_SETTINGS;
  void _layout;
  void _dismissed;
  useSettings.getState().update(defaults);
}
