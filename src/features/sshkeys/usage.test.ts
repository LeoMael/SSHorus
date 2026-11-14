// Pruebas del uso detectado de cada llave (GitHub / servidores).
// Ejecutar: npx rolldown src/features/sshkeys/usage.test.ts -p node -f esm -o /tmp/usage.mjs && node /tmp/usage.mjs
import type { ConfigHost, LocalPrivateKey } from "../../api/localkeys";
import type { ServerProfile } from "../../api/types";
import { groupByUsage, keyOptionLabel, keyUsage, publicKeyId, usageTags, usageText } from "./usage";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const key = (name: string, extra: Partial<LocalPrivateKey> = {}): LocalPrivateKey => ({
  path: `/h/.ssh/${name}`,
  name,
  kind: "ed25519",
  comment: "",
  encrypted: false,
  publicLine: null,
  configHosts: [],
  ...extra,
});
const host = (alias: string, hostname = alias): ConfigHost => ({ alias, hostname });
const srv = (name: string, keyPath: string | null, auth: ServerProfile["auth"] = "key"): ServerProfile => ({
  id: name,
  name,
  host: "10.0.0.1",
  port: 22,
  username: "root",
  auth,
  keyPath,
  defaultPath: null,
  color: null,
});
const none = new Set<string>();

// GitHub por ~/.ssh/config
eq(keyUsage(key("trabajo", { configHosts: [host("github.com")] }), [], none).github, true, "Host github.com");
eq(keyUsage(key("trabajo", { configHosts: [host("gh-work", "GitHub.com")] }), [], none).github, true, "HostName github.com");
eq(keyUsage(key("trabajo", { configHosts: [host("gh443", "ssh.github.com")] }), [], none).github, true, "ssh.github.com");

// GitHub por el nombre
for (const n of ["id_ed25519_github", "gh", "id_gh", "gh_trabajo", "GitHub-personal"]) eq(keyUsage(key(n), [], none).github, true, `nombre ${n}`);
for (const n of ["ghost", "id_ed25519", "high"]) eq(keyUsage(key(n), [], none).github, false, `nombre ${n}`);

// GitHub por la cuenta conectada (el comentario no cuenta)
const line = "ssh-ed25519 AAAAC3Nza ana@pc";
eq(publicKeyId(line), "ssh-ed25519 AAAAC3Nza", "id de la pública");
eq(keyUsage(key("id_ed25519", { publicLine: line }), [], new Set(["ssh-ed25519 AAAAC3Nza"])).github, true, "en la cuenta");
eq(keyUsage(key("id_ed25519", { publicLine: line }), [], new Set(["ssh-ed25519 OTRA"])).github, false, "no está en la cuenta");

// Servidores: guardados en SSHorus (con ~ o absoluta) y Host de ~/.ssh/config (sin los de GitHub)
const servers = [srv("TESIS", "~/.ssh/id_ed25519"), srv("web", "/h/.ssh/id_ed25519"), srv("clave", "/h/.ssh/id_ed25519", "password"), srv("otra", "/h/.ssh/otra")];
const k = key("id_ed25519", { configHosts: [host("github.com"), host("nas", "192.168.1.9"), host("web")] });
const u = keyUsage(k, servers, none);
eq(u, { github: true, servers: ["TESIS", "web", "nas"], group: "servers" }, "servidores y GitHub");
eq(usageText(u), "GitHub · Usada en: TESIS, web, nas", "texto");
eq(usageTags(u), ["Servidores", "GitHub"], "etiquetas");
eq(keyOptionLabel(k, u), "id_ed25519 (ed25519) — GitHub · Usada en: TESIS, web, nas", "opción");
eq(usageText({ github: false, servers: ["a", "b", "c", "d", "e"], group: "servers" }), "Usada en: a, b, c y 2 más", "resumen");
eq(keyOptionLabel(key("suelta"), keyUsage(key("suelta"), [], none)), "suelta (ed25519)", "sin uso");

// Grupos
const items = [key("id_ed25519"), key("gh"), key("tesis", { configHosts: [host("tesis", "10.0.0.5")] }), key("vieja")].map((x) => ({
  ...x,
  usage: keyUsage(x, [], none),
}));
eq(
  groupByUsage(items).map((g) => [g.title, g.items.map((i) => i.name)]),
  [
    ["Para servidores", ["tesis"]],
    ["Para GitHub", ["gh"]],
    ["Otras", ["id_ed25519", "vieja"]],
  ],
  "grupos en orden",
);
eq(groupByUsage(items.filter((i) => i.usage.group === "other")).length, 1, "un solo grupo");

console.log(`usage: ${passed} comprobaciones OK`);
