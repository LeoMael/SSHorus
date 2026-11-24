// Pruebas de los textos y el resumen de permisos del asistente en Ajustes.
// Ejecutar: npx rolldown src/features/mcp/accessInfo.test.ts -p node -f esm -o /tmp/ai.mjs && node /tmp/ai.mjs
import type { McpConfig } from "../../api/mcp";
import { cleanFolder, matchingTemplate, nameError, parseNames, protectedOf, summarize, tasksText, TEMPLATES } from "./accessInfo";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const g = (tasks: string[], folders: string[] = [], freeCommands = false) =>
  ({ tasks, folders, freeCommands }) as Parameters<typeof tasksText>[0];

eq(matchingTemplate(g(["web"])), "web", "solo web");
eq(matchingTemplate(g(["users-delete", "users-create", "users-edit"])), "users", "orden no importa");
eq(matchingTemplate(g(["web"], [], true)), null, "con comandos libres no es plantilla");
eq(matchingTemplate(g(["web", "files"])), null, "a medida");
eq(TEMPLATES.find((t) => t.v === "deploy")?.tasks.length, 6, "despliegue");

eq(tasksText(g([])), "Nada marcado", "vacío");
eq(tasksText(g(["files", "web"], ["/srv/www"])), "Sitios web, Archivos en /srv/www", "orden y carpetas");
eq(tasksText(g(["web"], [], true)), "Comandos libres (todo)", "libres");

eq(parseNames(" root, ana  ana;bob "), ["root", "ana", "bob"], "lista");
eq(nameError("no-existe"), null, "no hace falta que exista");
eq(nameError("a:b") !== null, true, "nombre raro");
eq(cleanFolder("/srv//www/../app/"), "/srv/app", "carpeta");
eq(cleanFolder("srv"), null, "relativa");

const cfg = {
  enabled: true,
  port: 1,
  approvalTimeoutSecs: 60,
  access: { a: "custom", b: "full", c: "read" },
  remembered: {},
  autoAccept: {},
  allowSudoReveal: true,
  grants: { a: { tasks: ["users-create"], folders: [], freeCommands: false } },
  protectedUsers: { a: ["ana", "root"] },
  protectedGlobal: ["root"],
} as McpConfig;
eq(protectedOf(cfg, "a"), ["ana", "root"], "protegidos sin repetir");
eq(summarize(cfg, "a"), { access: "custom", accessLabel: "Solo lo marcado", can: "Usuarios: crear", protectedUsers: ["ana", "root"] }, "resumen a");
eq(summarize(cfg, "b").can, "Todo, con tu permiso", "completo");
eq(summarize(cfg, "z"), { access: "none", accessLabel: "Sin acceso", can: "Nada (no lo ve)", protectedUsers: ["root"] }, "sin acceso");

console.log(`accessInfo: ${passed} comprobaciones correctas`);
