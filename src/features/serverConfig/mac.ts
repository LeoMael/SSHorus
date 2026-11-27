// Sección «SELinux» o «AppArmor» (control de acceso obligatorio): el que tenga el servidor, o «no aplica».
import { aaRows, parseAppArmor } from "./apparmor";
import { avcRow, groupAvc } from "./avc";
import { booleanChange, ENABLE_SELINUX_ADVICE, MODE_TEXT, modeChanges, parseBooleans, parseSelinux, SE_BOOLEANS } from "./selinux";
import { row, section, type ConfigSection, type Fact } from "./model";

type Lines = (k: string) => string[];

const SOURCE: Record<string, string> = { ausearch: "ausearch (desde ayer)", file: "/var/log/audit/audit.log (lo último)", journal: "el journal (últimas 24 h)" };

function selinuxSection(ls: Lines, elevated: boolean): ConfigSection {
  const se = parseSelinux(ls("selinux"));
  const bools = parseBooleans(ls("sebool"));
  const avc = ls("avc");
  const src = avc.find((l) => l.startsWith("@src "))?.slice(5) ?? null;
  const groups = groupAvc(avc.filter((l) => !l.startsWith("@")));
  const total = groups.reduce((a, g) => a + g.count, 0);
  const facts: Fact[] = [
    { label: "Modo ahora", value: se.mode ? MODE_TEXT[se.mode] : "no se supo", status: se.mode === "enforcing" ? "ok" : "warn" },
    { label: "Modo al arrancar", value: se.configMode ? MODE_TEXT[se.configMode] : "no se pudo leer /etc/selinux/config" },
  ];
  if (se.policy) facts.push({ label: "Política", value: se.policy });
  if (src) facts.push({ label: "Denegaciones leídas de", value: SOURCE[src] ?? src });
  const notes: string[] = [];
  if (avc.includes("@noread")) notes.push("Sin sudo no se pueden leer las denegaciones (audit.log solo lo lee root).");
  else if (avc.includes("@partial") && !elevated) notes.push("Sin sudo puede que no se vean todas las denegaciones.");
  if (se.mode === "disabled") notes.push(ENABLE_SELINUX_ADVICE);
  const status = se.mode === "enforcing" ? (groups.some((g) => !g.sample.permissive) ? "warn" : "ok") : se.mode === "disabled" ? "warn" : se.mode === "permissive" ? "warn" : "skip";
  const tail = total ? `; ${total} denegaciones recientes` : "";
  const summary =
    se.mode === "enforcing"
      ? `SELinux protege el servidor (Enforcing)${tail}`
      : se.mode === "permissive"
        ? `SELinux solo avisa, no bloquea (Permissive)${tail}`
        : se.mode === "disabled"
          ? "SELinux está desactivado"
          : "SELinux está instalado, pero no se pudo leer su modo";
  const boolRows = SE_BOOLEANS.filter((b) => bools.has(b.name)).map((b) => {
    const on = bools.get(b.name) === true;
    return row({ id: b.name, title: `${b.name}: ${on ? "activado" : "desactivado"}`, detail: b.what, status: on ? "info" : "ok", change: booleanChange(b.name, !on) });
  });
  return section({
    id: "mac",
    title: "SELinux",
    status,
    summary,
    facts,
    notes,
    changes: modeChanges(se, total),
    groups: [
      {
        title: "Denegaciones recientes",
        empty: avc.includes("@noread") ? "Sin sudo no se pueden leer" : se.mode === "disabled" ? "SELinux está desactivado" : "Ninguna: SELinux no ha bloqueado nada",
        rows: groups.slice(0, 40).map((g) => avcRow(g, bools)),
      },
      ...(boolRows.length ? [{ title: "Permisos útiles para la web y los contenedores (booleans)", empty: "", rows: boolRows }] : []),
    ],
  });
}

function appArmorSection(ls: Lines): ConfigSection {
  const aa = parseAppArmor(ls("apparmor"));
  if (!aa.enabled)
    return section({ id: "mac", title: "AppArmor", status: "info", summary: "AppArmor está en el kernel, pero apagado", notes: ["Debian y Ubuntu lo traen activo: suele apagarse con «apparmor=0» en el arranque."] });
  const enforce = aa.modes.enforce ?? 0;
  const facts: Fact[] = Object.entries(aa.modes).map(([m, n]) => ({ label: `Perfiles en modo ${m}`, value: String(n) }));
  const notes = aa.noread ? ["Sin sudo no se ven los perfiles."] : [];
  if (aa.complain.length) notes.push(`${aa.complain.length} perfiles solo avisan (complain): ${aa.complain.slice(0, 8).join(", ")}${aa.complain.length > 8 ? "…" : ""}.`);
  const rows = aaRows(ls("aadeny"));
  return section({
    id: "mac",
    title: "AppArmor",
    status: rows.length ? "warn" : aa.noread ? "info" : "ok",
    summary: aa.noread ? "AppArmor está activo" : `AppArmor está activo: ${enforce} perfiles bloquean lo que no está permitido`,
    facts,
    notes,
    groups: [{ title: "Denegaciones recientes (24 h)", empty: "Ninguna", rows }],
  });
}

export function macSection(ls: Lines, elevated: boolean): ConfigSection {
  if (parseSelinux(ls("selinux")).present) return selinuxSection(ls, elevated);
  if (parseAppArmor(ls("apparmor")).present) return appArmorSection(ls);
  return section({ id: "mac", title: "SELinux / AppArmor", status: "na", summary: "No aplica: este servidor no tiene SELinux ni AppArmor" });
}
