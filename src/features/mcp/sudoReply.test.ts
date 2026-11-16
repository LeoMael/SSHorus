// Pruebas de la respuesta a las peticiones de sudo del motor y de los textos del diálogo.
// Ejecutar: npx rolldown src/features/mcp/sudoReply.test.ts -p node -f esm -o /tmp/sr.mjs && node /tmp/sr.mjs
import { noPasswordWhy, sudoAskReason } from "./sudoReply";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(cond: boolean, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}

// ── Por qué no hace falta la contraseña (lo lee el motor) ──
eq(noPasswordWhy({ level: "root", hasSudo: false }), "root", "root sin sudo");
eq(noPasswordWhy({ level: "root", hasSudo: true }), "root", "root con sudo");
eq(noPasswordWhy({ level: "sudo-nopasswd", hasSudo: true }), "nopasswd", "sudo sin contraseña");
eq(noPasswordWhy({ level: "user", hasSudo: false }), "no-sudo", "usuario normal sin sudo");
eq(noPasswordWhy({ level: "sudo-nopasswd", hasSudo: false }), "no-sudo", "doas sin contraseña: sudo no está");

// ── Textos del diálogo ──
const cmd = sudoAskReason({ purpose: "command", serverName: "web", auto: true });
ok(cmd.includes("«web»") && cmd.includes("aceptado automáticamente") && cmd.includes("no la ve"), `comando: ${cmd}`);
ok(sudoAskReason({ purpose: "command", serverName: "web" }).includes("ya le diste permiso"), "comando aprobado");
const rev = sudoAskReason({ purpose: "reveal", serverName: "web", reason: "instalar X" });
ok(rev.includes("quedará en la conversación con la IA") && rev.includes("«instalar X»"), `revelar: ${rev}`);
ok(!sudoAskReason({ purpose: "reveal", serverName: "web" }).includes("Motivo"), "sin motivo no se inventa");

console.log(`sudoReply: ${passed} comprobaciones correctas`);
