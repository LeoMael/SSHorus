// Pruebas del buscador de Ajustes.
// Ejecutar: npx rolldown src/components/Settings/settingsSearch.test.ts -p node -f esm -o /tmp/ss.mjs && node /tmp/ss.mjs
import { filterNav, fold } from "./settingsSearch";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

eq(fold("Conexión ÁÉÍÓÚ Ñ"), "conexion aeiou n", "minúsculas y sin tildes");

const nav = [
  {
    group: "General",
    items: [
      { id: "appearance", label: "Apariencia", desc: "Tema de colores.", keys: "tema claro oscuro" },
      { id: "terminal", label: "Terminal", desc: "Letra y tmux.", keys: "gpu webgl" },
    ],
  },
  { group: "Sistema", items: [{ id: "about", label: "Acerca de", desc: "Versión.", keys: "actualizaciones" }] },
];
const ids = (q: string) => filterNav(nav, q).map((g) => [g.group, g.items.map((s) => s.id)]);

eq(filterNav(nav, "  ") === nav, true, "sin búsqueda: la lista tal cual");
eq(ids("terminal"), [["General", ["terminal"]]], "por título");
eq(ids("versión"), [["Sistema", ["about"]]], "por descripción");
eq(ids("WEBGL"), [["General", ["terminal"]]], "por palabra clave, sin importar mayúsculas");
eq(ids("version"), [["Sistema", ["about"]]], "sin tildes encuentra con tildes");
eq(ids(" a "), [["General", ["appearance", "terminal"]], ["Sistema", ["about"]]], "se recortan los espacios");
eq(ids("nada así"), [], "sin resultados: sin grupos");

console.log(`settingsSearch: ${passed} pruebas OK`);
