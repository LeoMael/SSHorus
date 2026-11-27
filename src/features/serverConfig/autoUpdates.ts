// Actualizaciones automáticas: dnf-automatic (Rocky, Alma, RHEL, Fedora) o unattended-upgrades (Debian,
// Ubuntu). En openSUSE y Alpine no hay un servicio estándar: se dice «no aplica» y qué hacer. Puras.
import { change, section, type ConfigChange, type ConfigSection, type Fact } from "./model";

export interface AutoUpdState {
  pm: string | null;
  systemd: boolean;
  podman: boolean;
  pkgs: Map<string, string>;
  /** unidad → [enabled, active] */
  timers: Map<string, [string, string]>;
  /** Claves de /etc/dnf/automatic.conf. */
  conf: Map<string, string>;
  /** APT::Periodic::… → valor. */
  apt: Map<string, string>;
}

export function parseAutoUpd(ls: string[]): AutoUpdState {
  const st: AutoUpdState = { pm: null, systemd: false, podman: false, pkgs: new Map(), timers: new Map(), conf: new Map(), apt: new Map() };
  for (const l of ls) {
    const [k, ...rest] = l.trim().split(/\s+/);
    if (k === "pm") st.pm = rest[0] ?? null;
    else if (k === "systemd") st.systemd = rest[0] === "yes";
    else if (k === "podman") st.podman = true;
    else if (k === "pkg" && rest[0]) st.pkgs.set(rest[0], rest[1] ?? "");
    else if (k === "timer" && rest[0]) st.timers.set(rest[0], [rest[1] ?? "", rest[2] ?? ""]);
    else if (k === "conf") {
      const m = /^conf\s+([a-z_]+)\s*=\s*(\S*)/.exec(l.trim());
      if (m) st.conf.set(m[1], m[2].toLowerCase());
    } else if (k === "apt") {
      const m = /^apt\s+APT::Periodic::(\S+)\s+"([^"]*)"/.exec(l.trim());
      if (m) st.apt.set(m[1], m[2]);
    }
  }
  return st;
}

const DNF_TIMERS = ["dnf-automatic.timer", "dnf-automatic-install.timer", "dnf5-automatic.timer"];
const on = (t: [string, string] | undefined) => !!t && t[0] === "enabled";

// Fija «clave = valor» en la sección [commands] de automatic.conf (la crea si falta).
const SETINI = [
  "f=/etc/dnf/automatic.conf",
  '[ -f "$f" ] || printf \'[commands]\\n\' > "$f"',
  "grep -q '^\\[commands\\]' \"$f\" || printf '\\n[commands]\\n' >> \"$f\"",
  'setini() { if grep -qE "^[[:space:]]*#?[[:space:]]*$1[[:space:]]*=" "$f"; then sed -i -E "s/^[[:space:]]*#?[[:space:]]*$1[[:space:]]*=.*/$1 = $2/" "$f"; else sed -i "/^\\[commands\\]/a $1 = $2" "$f"; fi; }',
];

const ENABLE_DNF_TIMER =
  'for t in dnf-automatic.timer dnf5-automatic.timer; do if systemctl list-unit-files "$t" 2>/dev/null | grep -q "^$t"; then systemctl enable --now "$t"; ok=1; break; fi; done; [ -n "${ok:-}" ] || { echo \'No se encontró el temporizador de dnf-automatic\' >&2; exit 1; }';

function dnfEnable(type: "security" | "default"): ConfigChange {
  return change({
    id: `updates.dnf.${type}`,
    label: type === "security" ? "Activar (solo seguridad)" : "Activar (todo)",
    title: `Actualizaciones automáticas ${type === "security" ? "de seguridad" : "completas"} (dnf-automatic)`,
    explain:
      type === "security"
        ? "Instala dnf-automatic y aplica cada día solo las actualizaciones de seguridad."
        : "Instala dnf-automatic y aplica cada día todas las actualizaciones.",
    steps: ["command -v dnf-automatic >/dev/null 2>&1 || rpm -q dnf5-plugin-automatic >/dev/null 2>&1 || dnf -y install dnf-automatic", ...SETINI, "setini apply_updates yes", `setini upgrade_type ${type}`, ENABLE_DNF_TIMER],
    note: "Si una actualización necesita reiniciar (kernel), no se reinicia sola: lo verás en la Auditoría",
    timeoutSecs: 900,
  });
}

const APT_ENABLE = change({
  id: "updates.apt",
  label: "Activar",
  title: "Actualizaciones automáticas de seguridad (unattended-upgrades)",
  explain: "Instala unattended-upgrades y aplica cada día las actualizaciones de seguridad de la distro.",
  steps: [
    "export DEBIAN_FRONTEND=noninteractive",
    "dpkg-query -W -f '${Status}' unattended-upgrades 2>/dev/null | grep -q 'install ok installed' || { apt-get update -qq; apt-get install -y unattended-upgrades; }",
    "printf 'APT::Periodic::Update-Package-Lists \"1\";\\nAPT::Periodic::Unattended-Upgrade \"1\";\\n' > /etc/apt/apt.conf.d/20auto-upgrades",
    "systemctl enable --now apt-daily.timer apt-daily-upgrade.timer",
  ],
  timeoutSecs: 900,
});

function disable(units: string[]): ConfigChange {
  return change({
    id: "updates.off",
    label: "Desactivar",
    title: "Desactivar las actualizaciones automáticas",
    explain: "Las actualizaciones dejan de aplicarse solas: tendrás que hacerlo tú.",
    steps: [`systemctl disable --now ${units.join(" ")}`],
    danger: true,
    note: "Sin actualizaciones automáticas, los fallos de seguridad quedan abiertos hasta que actualices a mano",
  });
}

const NA = (summary: string, notes: string[]): ConfigSection => section({ id: "updates", title: "Actualizaciones automáticas", status: "na", summary, notes });

export function autoUpdSection(st: AutoUpdState): ConfigSection {
  const title = "Actualizaciones automáticas";
  if (st.pm === "dnf" || st.pm === "yum") {
    const installed = st.pkgs.has("dnf-automatic") || st.pkgs.has("dnf5-plugin-automatic");
    const timers = DNF_TIMERS.filter((t) => on(st.timers.get(t)));
    const apply = st.conf.get("apply_updates") === "yes";
    const type = st.conf.get("upgrade_type") ?? "default";
    // dnf-automatic-install.timer instala aunque apply_updates diga «no».
    const applies = timers.includes("dnf-automatic-install.timer") || (timers.length > 0 && apply);
    const facts: Fact[] = [
      { label: "dnf-automatic", value: installed ? "instalado" : "no instalado", status: installed ? "ok" : "warn" },
      { label: "Temporizador", value: !st.systemd ? "sin systemd (no se puede ver)" : timers.length ? timers.join(", ") : "apagado", status: timers.length ? "ok" : "warn" },
    ];
    if (installed) facts.push({ label: "Qué hace", value: applies ? (type === "security" ? "instala solo las de seguridad" : "instala todas") : "solo descarga o avisa" });
    const notes = st.podman && applies && type === "security"
      ? ["Con «solo seguridad» puede actualizarse podman sin netavark ni containers-common y romper los contenedores. Si pasa, actualiza esos paquetes juntos (o cambia a «todo»)."]
      : [];
    if (!st.systemd) notes.push("Sin systemd no se ve el temporizador: dnf-automatic necesita systemd para ejecutarse solo.");
    const changes = !st.systemd ? [] : applies ? [type === "security" ? dnfEnable("default") : dnfEnable("security"), disable(timers)] : [dnfEnable("security"), dnfEnable("default")];
    if (applies) changes[0] = { ...changes[0], label: type === "security" ? "Cambiar a «todo»" : "Cambiar a «solo seguridad»" };
    return section({
      id: "updates",
      title,
      status: applies ? "ok" : "warn",
      summary: applies ? `Activas: dnf-automatic instala ${type === "security" ? "las de seguridad" : "todas"} cada día` : "No se instalan solas: tienes que actualizar a mano",
      facts,
      changes,
      notes,
    });
  }
  if (st.pm === "apt-get") {
    const installed = st.pkgs.has("unattended-upgrades");
    const enabled = st.apt.get("Unattended-Upgrade") === "1";
    const timer = st.timers.get("apt-daily-upgrade.timer");
    const applies = installed && enabled && (!st.systemd || on(timer));
    const facts: Fact[] = [
      { label: "unattended-upgrades", value: installed ? "instalado" : "no instalado", status: installed ? "ok" : "warn" },
      { label: "APT::Periodic::Unattended-Upgrade", value: st.apt.get("Unattended-Upgrade") ?? "sin definir", status: enabled ? "ok" : "warn" },
    ];
    if (st.systemd) facts.push({ label: "apt-daily-upgrade.timer", value: timer ? timer.join(" · ") : "no existe", status: on(timer) ? "ok" : "warn" });
    return section({
      id: "updates",
      title,
      status: applies ? "ok" : "warn",
      summary: applies ? "Activas: unattended-upgrades instala las de seguridad cada día" : "No se instalan solas: tienes que actualizar a mano",
      facts,
      changes: !st.systemd ? [] : applies ? [disable(["apt-daily-upgrade.timer"])] : [APT_ENABLE],
      notes: st.systemd ? [] : ["Sin systemd no hay temporizador: unattended-upgrades no se ejecutará solo."],
    });
  }
  if (st.pm === "zypper")
    return NA("No aplica: openSUSE no trae un servicio estándar de actualizaciones automáticas", [
      "Puedes programar «zypper --non-interactive patch --category security» con un temporizador o una tarea cron.",
    ]);
  if (st.pm === "apk") return NA("No aplica: Alpine no trae actualizaciones automáticas", ["Puedes programar «apk upgrade --available» en una tarea cron (/etc/periodic/daily)."]);
  return NA("No aplica: no se reconoce el gestor de paquetes", []);
}
