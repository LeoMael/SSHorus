// Pruebas del detector de avisos de contraseña.
// Ejecutar: npx rolldown src/components/Terminal/passwordPrompt.test.ts -p node -f esm -o /tmp/pp.mjs && node /tmp/pp.mjs
import { isPasswordPrompt } from "./passwordPrompt";

let passed = 0;
function eq(got: boolean, want: boolean, what: string) {
  if (got !== want) throw new Error(`${what}: esperaba ${want}, llegó ${got}`);
  passed++;
}

// ───────── Sí piden contraseña ─────────
eq(isPasswordPrompt("[sudo] password for leo: "), true, "sudo en inglés");
eq(isPasswordPrompt("[sudo] contraseña para leo: "), true, "sudo en español");
eq(isPasswordPrompt("[SUDO] PASSWORD FOR leo:"), true, "sin distinguir mayúsculas");
eq(isPasswordPrompt("Password: "), true, "su / passwd");
eq(isPasswordPrompt("Contraseña:"), true, "su en español");
eq(isPasswordPrompt("contraseña para leo: "), true, "«contraseña para …»");
eq(isPasswordPrompt("Password for root:"), true, "«Password for …»");
eq(isPasswordPrompt("   [sudo] password for web-admin:   "), true, "espacios alrededor");

// ───────── No piden contraseña ─────────
eq(isPasswordPrompt(""), false, "línea vacía");
eq(isPasswordPrompt("leo@srv:~$ "), false, "prompt de la shell");
eq(isPasswordPrompt("leo@srv:~$ echo Password:"), false, "echo tras el prompt");
eq(isPasswordPrompt("leo@srv:~$ sudo apt update"), false, "comando con sudo aún sin aviso");
eq(isPasswordPrompt("Sorry, try again."), false, "aviso de error de sudo");
eq(isPasswordPrompt("Password changed successfully"), false, "no termina en dos puntos");
eq(isPasswordPrompt("Password: hunter2"), false, "algo escrito tras el aviso");
eq(isPasswordPrompt("Old password:"), false, "passwd pide la actual: no es la de sudo");
eq(isPasswordPrompt("leo@otro's password:"), false, "ssh a otro equipo");
eq(isPasswordPrompt("Enter passphrase for key '/home/leo/.ssh/id_ed25519':"), false, "frase de una llave");
eq(isPasswordPrompt(`Password for ${"x".repeat(300)}:`), false, "líneas muy largas");

console.log(`passwordPrompt: ${passed} pruebas correctas`);
