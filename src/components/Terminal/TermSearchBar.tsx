// Barra de búsqueda de la terminal (Ctrl+Mayús+F): búsqueda incremental, anterior/siguiente y
// distinguir mayúsculas.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { SearchResults } from "../../features/terminal";
import type { TermController } from "./termController";

interface TermSearchProps {
  ctrl: TermController;
  /** Cambia cada vez que se pide abrir: vuelve a enfocar y seleccionar el texto. */
  focusSeq: number;
  onClose: () => void;
}

export function TermSearchBar({ ctrl, focusSeq, onClose }: TermSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);

  useEffect(() => ctrl.onSearchResults(setResults), [ctrl]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [focusSeq]);

  // Búsqueda incremental al escribir o cambiar mayúsculas.
  useEffect(() => {
    if (!query) {
      ctrl.clearSearch();
      setResults(null);
      return;
    }
    ctrl.findNext(query, caseSensitive, true);
  }, [ctrl, query, caseSensitive]);

  const next = () => ctrl.findNext(query, caseSensitive);
  const prev = () => ctrl.findPrevious(query, caseSensitive);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) prev();
      else next();
    } else if (e.altKey && e.code === "KeyC") {
      e.preventDefault();
      setCaseSensitive((v) => !v);
    }
  };

  let counter = "";
  if (query && results) {
    if (results.count === 0) counter = "Sin resultados";
    else if (results.index >= 0) counter = `${results.index + 1} de ${results.count}`;
    else counter = `${results.count}`;
  }

  return (
    <div className="term-search" role="search" onKeyDown={onKey} onContextMenu={(e) => e.stopPropagation()}>
      <Search size={13} className="term-search-icon" aria-hidden />
      <input
        ref={inputRef}
        className="term-search-input"
        value={query}
        placeholder="Buscar"
        aria-label="Buscar en la terminal"
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
      />
      <span className={`term-search-count${results?.count === 0 && query ? " none" : ""}`} aria-live="polite">
        {counter}
      </span>
      <button
        type="button"
        className={`term-search-btn term-search-case${caseSensitive ? " on" : ""}`}
        aria-pressed={caseSensitive}
        title="Distinguir mayúsculas (Alt+C)"
        aria-label="Distinguir mayúsculas"
        onClick={() => setCaseSensitive((v) => !v)}
      >
        Aa
      </button>
      <button
        type="button"
        className="term-search-btn"
        title="Anterior (Mayús+Enter)"
        aria-label="Coincidencia anterior"
        disabled={!query}
        onClick={prev}
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        className="term-search-btn"
        title="Siguiente (Enter)"
        aria-label="Coincidencia siguiente"
        disabled={!query}
        onClick={next}
      >
        <ChevronDown size={14} />
      </button>
      <button type="button" className="term-search-btn" title="Cerrar (Esc)" aria-label="Cerrar búsqueda" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  );
}
