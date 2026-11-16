// Pruebas de las funciones puras de la terminal (copiar, pegar, atajo Ctrl+C, fuentes).
// Ejecutar: npx rolldown src/components/Terminal/termText.test.ts -p node -f esm -o /tmp/tt.mjs && node /tmp/tt.mjs
import { cleanCopiedText, isPlainCtrlC, pasteNeedsConfirm, pastePreview, pastedLines } from "./termText";
import { terminalFontStack } from "./termFont";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

// ───────── Copiar ─────────
eq(cleanCopiedText("hola   \nmundo\t \n"), "hola\nmundo", "quita el relleno de cada línea y el salto final");
eq(cleanCopiedText("a  \r\nb  "), "a\r\nb", "respeta los saltos de Windows");
eq(cleanCopiedText("  sangría\n\n  sigue"), "  sangría\n\n  sigue", "la sangría y las líneas vacías intermedias se quedan");
eq(cleanCopiedText("⏺ Listo.  "), "⏺ Listo.", "espacios duros de relleno");
eq(cleanCopiedText("   "), "", "solo espacios");
eq(cleanCopiedText("x\n\n\n"), "x", "líneas vacías del final");

// ───────── Pegar ─────────
eq(pastedLines("ls\n"), ["ls"], "un comando con salto final es una línea");
eq(pastedLines("a\r\nb\rc"), ["a", "b", "c"], "todos los saltos");
eq(pastedLines(""), [], "vacío");
eq(pasteNeedsConfirm("ls -la", false), false, "una línea: sin aviso");
eq(pasteNeedsConfirm("ls\n", false), false, "una línea con salto: sin aviso");
eq(pasteNeedsConfirm("cd /\nrm -rf x", false), true, "varias líneas sin protección: aviso");
eq(pasteNeedsConfirm("cd /\nrm -rf x", true), false, "con pegado entre corchetes: sin aviso");
eq(pastePreview("1\n2\n3", 2), "1\n2\n… y 1 líneas más", "vista previa recortada");
eq(pastePreview("x".repeat(5), 6, 3), "xxx…", "líneas largas recortadas");

// ───────── Ctrl+C ─────────
const k = (p: Partial<KeyboardEvent>) => ({ ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, code: "", ...p });
eq(isPlainCtrlC(k({ ctrlKey: true, code: "KeyC" })), true, "Ctrl+C");
eq(isPlainCtrlC(k({ ctrlKey: true, shiftKey: true, code: "KeyC" })), false, "Ctrl+Mayús+C es el atajo de copiar, no este");
eq(isPlainCtrlC(k({ code: "KeyC" })), false, "solo C");

// ───────── Fuentes ─────────
eq(
  terminalFontStack("'JetBrains Mono', 'Fira Code', 'Noto Sans Mono', monospace"),
  `'JetBrains Mono', 'Fira Code', 'Noto Sans Mono', "Cascadia Mono", Consolas, "SF Mono", Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace`,
  "reservas antes de monospace",
);
eq(terminalFontStack("Menlo"), `Menlo, "Cascadia Mono", Consolas, "SF Mono", "DejaVu Sans Mono", "Liberation Mono", monospace`, "sin repetir");
eq(terminalFontStack(terminalFontStack("Menlo")), terminalFontStack("Menlo"), "aplicarla dos veces no cambia nada");

console.log(`termText: ${passed} comprobaciones correctas`);
