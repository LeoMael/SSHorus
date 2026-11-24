// Búsqueda en el historial de una terminal (Ctrl+Mayús+F), con las coincidencias resaltadas.
import type { Terminal } from "@xterm/xterm";
import { SearchAddon, type ISearchResultChangeEvent } from "@xterm/addon-search";
import { buildSearchDecorations } from "./termTheme";
import type { SearchResults } from "./termTypes";

export class TermSearch {
  private readonly addon = new SearchAddon({ highlightLimit: 2000 });

  constructor(private readonly term: Terminal) {
    term.loadAddon(this.addon);
  }

  private opts(caseSensitive: boolean, incremental = false) {
    return { caseSensitive, incremental, decorations: buildSearchDecorations() };
  }

  /** Busca hacia abajo. `incremental`: mientras se escribe (no avanza si la actual sigue valiendo). */
  findNext(query: string, caseSensitive: boolean, incremental = false): boolean {
    if (!query) return false;
    return this.addon.findNext(query, this.opts(caseSensitive, incremental));
  }

  findPrevious(query: string, caseSensitive: boolean): boolean {
    if (!query) return false;
    return this.addon.findPrevious(query, this.opts(caseSensitive));
  }

  /** Quita los resaltados y la selección de la coincidencia actual. */
  clear() {
    this.addon.clearDecorations();
    this.term.clearSelection();
  }

  /** Avisa de «coincidencia N de M»; devuelve la función para dejar de escuchar. */
  onResults(cb: (r: SearchResults) => void): () => void {
    const d = this.addon.onDidChangeResults((e: ISearchResultChangeEvent) =>
      cb({ index: e.resultIndex, count: e.resultCount }),
    );
    return () => d.dispose();
  }
}
