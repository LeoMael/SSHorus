// Pruebas de las utilidades compartidas para scripts remotos: secciones, citas, os-release y direcciones.
// Ejecutar: npx rolldown src/lib/remote/remote.test.ts -p node -f esm -o /tmp/rt.mjs && node /tmp/rt.mjs
import { parseAddr, parseOsRelease, shJoin, shQuote, shQuoteMinimal, splitSections } from ".";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
const entries = (m: Map<string, string[]>) => [...m];

// ── Secciones ──
const out = "basura\n@@users\r\nana\n\n  \nluis\r\n@@end\n";
eq(entries(splitSections(out)), [["users", ["ana", "  ", "luis"]], ["end", []]], "por defecto: «@@nombre», sin vacías ni \\r, se ignora lo de antes");
eq(entries(splitSections(out, { blank: "dropBlank" })), [["users", ["ana", "luis"]], ["end", []]], "dropBlank: fuera también las de espacios");
eq(entries(splitSections(out, { blank: "keep" })), [["users", ["ana", "", "  ", "luis"]], ["end", [""]]], "keep: se conservan todas");
eq(entries(splitSections("@@a\nx\n@@a\ny")), [["a", ["y"]]], "sección repetida: empieza de cero");
eq(entries(splitSections("@@a\nx\n@@a\ny", { repeat: "append" })), [["a", ["x", "y"]]], "append: sigue añadiendo");
eq(entries(splitSections("@@Mayus\n@@con espacio\n@@ok\nz")), [["ok", ["z"]]], "exact: solo minúsculas y la línea entera");

const fleet = "@@ct=docker\nweb|running\n@@ct=podman\ndb|exited\n@@ct=docker\napi|running\n@@reboot=1\n";
eq(
  entries(splitSections(fleet, { header: "prefix", blank: "dropBlank", repeat: "append" })),
  [["ct=docker", ["web|running", "api|running"]], ["ct=podman", ["db|exited"]], ["reboot=1", []]],
  "prefix: el nombre es todo lo que sigue a @@",
);
eq(entries(splitSections("@@self=123\n@@stat\ncpu 1\n@@ x \n1", { header: "key" })), [["self", []], ["stat", ["cpu 1"]], ["x", ["1"]]], "key: el nombre llega hasta «=»");

const tv = "@@TV:os@@\nID=debian\n\n  \n @@TV:kernel@@ \r\nLinux 6\n\n@@x\n";
eq(
  entries(splitSections(tv, { header: "tv", blank: "trimEnd" })),
  [["os", ["ID=debian"]], ["kernel", ["Linux 6", "", "@@x"]]],
  "tv: marca @@TV:…@@ y se quitan las líneas en blanco del final",
);
eq(entries(splitSections("#a\n1\n#b\n2", { header: (l) => /^#(\w)$/.exec(l)?.[1] ?? null })), [["a", ["1"]], ["b", ["2"]]], "marca propia");

// ── Citas ──
eq(shQuote("it's"), `'it'\\''s'`, "comilla simple interna");
eq(shQuote(""), "''", "vacío citado");
eq(shJoin(["a b", "c"]), "'a b' 'c'", "shJoin cita todo");
eq(shQuoteMinimal("/srv/app"), "/srv/app", "palabra segura sin comillas");
eq(shQuoteMinimal(""), "''", "vacío");
eq(shQuoteMinimal("a b"), "'a b'", "con espacio");
eq(shQuoteMinimal("~/mi carpeta"), "~/'mi carpeta'", "~ se expande");
eq(shQuoteMinimal("~ana/a b"), "~ana/'a b'", "~usuario se expande");
eq(shQuoteMinimal("$(rm -rf /)"), "'$(rm -rf /)'", "sustitución citada");

// ── os-release ──
const os = parseOsRelease('NAME="Rocky Linux"\nID="rocky"\nID_LIKE="rhel centos fedora"\n# comentario\nPRETTY_NAME=\'Rocky 9\'\r\nVERSION_ID=9\n');
eq(os.ID, "rocky", "ID sin comillas");
eq(os.ID_LIKE, "rhel centos fedora", "ID_LIKE");
eq(os.PRETTY_NAME, "Rocky 9", "comillas simples y \\r");
eq(os.VERSION_ID, "9", "sin comillas");
eq(Object.keys(parseOsRelease("hola\n=x\nid=minus")).length, 0, "líneas que no son CLAVE=valor");

// ── Direcciones ──
eq(parseAddr("0.0.0.0:22"), { ip: "0.0.0.0", iface: null, port: 22 }, "IPv4");
eq(parseAddr("[::1]:8080"), { ip: "::1", iface: null, port: 8080 }, "IPv6 con corchetes");
eq(parseAddr("fe80::1%eth0:53"), { ip: "fe80::1", iface: "eth0", port: 53 }, "interfaz");
eq(parseAddr("*:80"), { ip: "*", iface: null, port: 80 }, "comodín");
eq(parseAddr(":80"), null, "sin host");
eq(parseAddr("1.2.3.4:0"), null, "puerto 0");
eq(parseAddr("1.2.3.4:*"), null, "puerto no numérico");

console.log(`remote: ${passed} comprobaciones OK`);
