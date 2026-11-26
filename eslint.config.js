import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// ── Límites entre carpetas (docs/ARQUITECTURA.md §5, «Dónde va cada archivo») ─────────────────────
// Qué no puede importar cada carpeta de src/. Lo comprueban dos reglas que trae ESLint (sin plugins):
// `no-restricted-imports` (import y export … from) y `no-restricted-syntax` (import() dinámico y los
// tipos import("…")). En src/ todas las rutas son relativas y no hay carpetas con el mismo nombre en
// otro nivel, así que el destino se reconoce por su carpeta («…/features/…»).

/** Destinos prohibidos: expresión sobre el texto del import, cómo se nombra y (si es siempre el mismo) por qué. */
const DESTINOS = {
  features: { re: String.raw`(?:^|/)features(?:/|$)`, nombre: "features/" },
  components: { re: String.raw`(?:^|/)components(?:/|$)`, nombre: "components/" },
  componentsSalvoUi: { re: String.raw`(?:^|/)components/(?!ui(?:/|$))`, nombre: "components/ (salvo components/ui)" },
  stores: { re: String.raw`(?:^|/)stores(?:/|$)`, nombre: "stores/" },
  tauriCore: { re: String.raw`^@tauri-apps/api/core$`, nombre: "@tauri-apps/api/core (invoke)", motivo: "solo src/api/ habla con el motor" },
};

/** Qué no puede importar cada carpeta. La primera es el resto de src/ (la más general). */
const LIMITES = [
  { carpeta: "src", quien: "Fuera de src/api/ no se importa", prohibido: ["tauriCore"] },
  { carpeta: "src/lib", prohibido: ["features", "components", "stores", "tauriCore"], motivo: "lib/ son utilidades puras sin dominio" },
  { carpeta: "src/features", prohibido: ["componentsSalvoUi", "tauriCore"], motivo: "features/ es lógica: de la interfaz solo usa components/ui" },
  { carpeta: "src/api", prohibido: ["features", "components", "stores"], motivo: "src/api/ es la puerta al motor y no depende de la app" },
];

// Excepciones: imports que ya rompían estos límites cuando se añadió la regla (25/11/2026), cada uno con
// su motivo, como { archivo, importa: [destinos] }. Solo valen para ese archivo y ese destino exacto. Ya
// no queda ninguna y la lista solo puede encoger: no añadas nada (mueve el código a su carpeta).
// `npm run check:deps` avisa si sobra alguna.
/** @type {{ archivo: string, importa: string[] }[]} */
export const EXCEPCIONES_LIMITES = [];

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Reglas de límites para una carpeta; `permitidos` son destinos exactos que se toleran (excepciones). */
function reglasLimites(limite, permitidos = []) {
  const excepto = permitidos.length
    ? String.raw`^(?!(?:.*/)?(?:${permitidos.map(escapar).join("|")})(?:\.tsx?)?$).*`
    : "";
  const grupos = limite.prohibido.map((id) => ({
    re: excepto + DESTINOS[id].re,
    message:
      `${limite.quien ?? `${limite.carpeta}/ no puede importar`} de ${DESTINOS[id].nombre}: ` +
      `${DESTINOS[id].motivo ?? limite.motivo} (docs/ARQUITECTURA.md §5).`,
  }));
  return {
    "no-restricted-imports": ["error", { patterns: grupos.map((g) => ({ regex: g.re, caseSensitive: true, message: g.message })) }],
    // import("…") diferido y tipos import("…").X. En el selector, la «/» de la expresión va escapada.
    "no-restricted-syntax": [
      "error",
      ...grupos.map((g) => ({
        selector: `:matches(ImportExpression, TSImportType) > Literal.source[value=/${g.re.replace(/\//g, "\\/")}/]`,
        message: g.message,
      })),
    ],
  };
}

const archivos = (carpeta) => [`${carpeta}/**/*.{ts,tsx}`];
const limiteDe = (archivo) =>
  LIMITES.filter((l) => archivo.startsWith(`${l.carpeta}/`)).sort((a, b) => b.carpeta.length - a.carpeta.length)[0];

const configLimites = [
  ...LIMITES.map((l) => ({ files: archivos(l.carpeta), rules: reglasLimites(l) })),
  ...EXCEPCIONES_LIMITES.map((e) => ({ files: [e.archivo], rules: reglasLimites(limiteDe(e.archivo), e.importa) })),
];

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-control-regex": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  ...configLimites,
);
