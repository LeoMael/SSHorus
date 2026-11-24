// Utilidades compartidas para los scripts que se ejecutan en el servidor: citas de shell, salida por
// secciones, os-release y direcciones «ip:puerto». Todo son funciones puras (sin React, Tauri ni stores),
// así cualquier función de `features/` puede usarlas sin depender de otra.
export { shJoin, shQuote, shQuoteMinimal } from "./shell";
export { SECTION_HEADERS, splitSections, type SectionHeader, type SplitSectionsOptions } from "./sections";
export { parseOsRelease } from "./osRelease";
export { parseAddr } from "./addr";
