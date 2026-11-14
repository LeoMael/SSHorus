// Pruebas de la lógica pura del PIN o la contraseña (textos según el tipo y reglas de lo nuevo).
// Ejecutar: npx rolldown src/features/lock/secretKind.test.ts -p node -f esm -o /tmp/sk.mjs && node /tmp/sk.mjs
import { checkNewPair, defaultNewKind, isValidPassword, secretWords } from "./secretKind";

declare const process: { exit(code: number): never };

let failed = 0;
let passed = 0;
function eq<T>(a: T, b: T, msg: string) {
  if (JSON.stringify(a) === JSON.stringify(b)) passed++;
  else {
    failed++;
    console.error(`✗ ${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
  }
}

// Textos
eq(secretWords("pin6").noun, "PIN", "pin6 dice PIN");
eq(secretWords("text").noun, "PIN", "las antiguas siguen diciendo PIN");
eq(secretWords(undefined).forgot, "Olvidé mi PIN", "sin estado: PIN");
eq(secretWords("password").noun, "contraseña", "password dice contraseña");
eq(secretWords("password").wrong, "Contraseña incorrecta.", "error con contraseña");
eq(secretWords("password").forgot, "Olvidé mi contraseña", "olvidé con contraseña");

// Tipo propuesto al cambiar
eq(defaultNewKind("pin6"), "pin6", "pin6 sigue pin6");
eq(defaultNewKind("password"), "password", "password sigue password");
eq(defaultNewKind("text"), "pin6", "las antiguas pasan a PIN");

// Contraseñas
for (const ok of ["12345678", "frase larga", "ññññññññ", "  ocho  !"]) eq(isValidPassword(ok), true, `válida «${ok}»`);
for (const bad of ["", "1234567", "ñandúes", "        "]) eq(isValidPassword(bad), false, `no válida «${bad}»`);

// Pares nuevos
eq(checkNewPair("pin6", "123456", "123456"), null, "PIN bien");
eq(checkNewPair("pin6", "12345", "12345"), "El PIN debe tener 6 números.", "PIN corto");
eq(checkNewPair("pin6", "123456", "654321"), "Los dos PIN no coinciden.", "PIN distinto");
eq(checkNewPair("password", "frase larga", "frase larga"), null, "contraseña bien");
eq(checkNewPair("password", "corta", "corta"), "La contraseña debe tener al menos 8 caracteres.", "contraseña corta");
eq(checkNewPair("password", "frase larga", "frase larg"), "Las dos contraseñas no coinciden.", "contraseña distinta");
eq(checkNewPair("password", "123456", "123456") !== null, true, "un PIN no vale como contraseña");

console.log(`${passed} pruebas bien, ${failed} mal`);
if (failed) process.exit(1);
