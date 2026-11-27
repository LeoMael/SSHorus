// Script de solo lectura del panel «Configuración». POSIX sh (bash, dash y el ash de Alpine), con poca
// prioridad (nice/ionice). Reutiliza tal cual las secciones de la Auditoría que le sirven (SSH, sudo,
// cortafuegos, fail2ban, /proc) y añade las suyas. Sin root muestra lo que pueda: cada sección dice
// «@noread» cuando lo que falta necesita sudo.
//
// Secciones propias:
//   @@selinux (sestatus o getenforce, «cfg SELINUX=…», «tool x») · @@sebool («nombre --> on»)
//   @@avc («@src ausearch|file|journal», «@partial», líneas «avc: denied») · @@apparmor («enabled Y», «p perfil (modo)»)
//   @@aadeny (líneas «apparmor="DENIED"») · @@autoupd («pm», «systemd», «pkg», «timer», «conf», «apt», «podman»)
//   @@fban (salida de fail2ban-client, «@jail nombre» por cárcel, «@none», «@noread») · @@sysctl («clave=valor»)
//   @@sysfile («archivo:clave = valor») · @@fstab (línea de /proc en /etc/fstab)
import { AUDIT_SCRIPT } from "../audit/script";
import { SE_BOOLEANS } from "./selinux";
import { SYSCTL_KEYS } from "./sysctl";

/** Secciones de la Auditoría que usa el panel (mismas líneas, mismo formato). */
export const AUDIT_SECTIONS = ["id", "os", "sshd", "sshdsrc", "sshdcfg", "sshinc", "passwd", "keys", "sudoers", "groups", "fw", "auth", "proc"];

/**
 * Las líneas de `script` de las secciones `ids` (en su orden original), precedidas de lo que va antes de
 * la primera sección (PATH, LC_ALL, `$TO`, `$ME`). Una sección empieza en la línea «echo @@nombre».
 */
export function pickSections(script: string, ids: string[]): { lines: string[]; missing: string[] } {
  const want = new Set(ids);
  const pre: string[] = [];
  const found = new Set<string>();
  const out: string[] = [];
  let cur: string | null = null;
  for (const l of script.split("\n")) {
    const m = /^echo @@([a-z]+)\b/.exec(l);
    if (m) cur = m[1];
    if (cur === null) pre.push(l);
    else if (want.has(cur)) {
      out.push(l);
      found.add(cur);
    }
  }
  return { lines: [...pre, ...out], missing: ids.filter((i) => !found.has(i)) };
}

const KEYS_RE = SYSCTL_KEYS.map((k) => k.key.replace(/\./g, "\\.")).join("|");

const OWN = [
  "T10=''; command -v timeout >/dev/null 2>&1 && T10='timeout 10'",
  "SD=no; [ -d /run/systemd/system ] && command -v journalctl >/dev/null 2>&1 && SD=yes",
  "JPART=''; [ \"$ME\" = 0 ] || id -Gn | grep -qwE 'adm|systemd-journal|wheel' || JPART=1",
  // SELinux.
  "echo @@selinux",
  "if command -v sestatus >/dev/null 2>&1; then sestatus 2>/dev/null",
  "elif command -v getenforce >/dev/null 2>&1; then echo \"Current mode: $(getenforce 2>/dev/null)\"",
  "elif [ -r /sys/fs/selinux/enforce ]; then echo \"enforce $(cat /sys/fs/selinux/enforce)\"; fi",
  "[ -r /etc/selinux/config ] && grep -E '^[[:space:]]*SELINUX(TYPE)?=' /etc/selinux/config | sed 's/^[[:space:]]*/cfg /'",
  "for t in semanage restorecon setsebool ausearch audit2why; do command -v $t >/dev/null 2>&1 && echo \"tool $t\"; done",
  "echo @@sebool",
  `if command -v getsebool >/dev/null 2>&1 && [ -d /sys/fs/selinux/booleans ]; then for b in ${SE_BOOLEANS.map((b) => b.name).join(" ")}; do getsebool "$b" 2>/dev/null; done; fi`,
  // Denegaciones de SELinux desde ayer: ausearch (root), audit.log (root) o el journal.
  "echo @@avc",
  "if [ -r /sys/fs/selinux/enforce ]; then",
  "  if [ \"$ME\" = 0 ] && command -v ausearch >/dev/null 2>&1; then echo '@src ausearch'; $TO ausearch -m AVC,USER_AVC -ts yesterday 2>/dev/null | grep -F 'avc:' | tail -n 300",
  "  elif [ \"$ME\" = 0 ] && [ -r /var/log/audit/audit.log ]; then echo '@src file'; grep -F 'avc:  denied' /var/log/audit/audit.log | tail -n 300",
  "  elif [ $SD = yes ]; then echo '@src journal'; [ -n \"$JPART\" ] && echo '@partial'; $TO journalctl -q --no-pager -o short-unix --since -24h _TRANSPORT=audit _TRANSPORT=kernel 2>/dev/null | grep -F 'avc:  denied' | tail -n 300",
  "  else echo @noread; fi",
  "fi",
  // AppArmor (Debian, Ubuntu, openSUSE).
  "echo @@apparmor",
  "AA=$(cat /sys/module/apparmor/parameters/enabled 2>/dev/null)",
  "[ -n \"$AA\" ] && echo \"enabled $AA\"",
  "if [ \"$AA\" = Y ]; then if [ -r /sys/kernel/security/apparmor/profiles ]; then sed 's/^/p /' /sys/kernel/security/apparmor/profiles | head -n 400; else echo @noread; fi; fi",
  "echo @@aadeny",
  "if [ \"$AA\" = Y ]; then",
  "  if [ $SD = yes ]; then [ -n \"$JPART\" ] && echo '@partial'; $TO journalctl -q --no-pager -o short-unix --since -24h _TRANSPORT=audit _TRANSPORT=kernel 2>/dev/null | grep -F 'apparmor=\"DENIED\"' | tail -n 300",
  "  else for f in /var/log/audit/audit.log /var/log/kern.log /var/log/syslog /var/log/messages; do [ -r \"$f\" ] && { grep -F 'apparmor=\"DENIED\"' \"$f\" | tail -n 300; break; }; done; fi",
  "fi",
  // Actualizaciones automáticas.
  "echo @@autoupd",
  "for p in dnf yum apt-get zypper apk; do command -v $p >/dev/null 2>&1 && { echo \"pm $p\"; break; }; done",
  "echo \"systemd $SD\"",
  "command -v podman >/dev/null 2>&1 && echo 'podman yes'",
  "if command -v rpm >/dev/null 2>&1; then for p in dnf-automatic dnf5-plugin-automatic; do v=$(rpm -q --qf '%{VERSION}' $p 2>/dev/null) && echo \"pkg $p $v\"; done; fi",
  "if command -v dpkg-query >/dev/null 2>&1; then v=$(dpkg-query -W -f '${Status} ${Version}' unattended-upgrades 2>/dev/null); case \"$v\" in 'install ok installed'*) echo \"pkg unattended-upgrades ${v##* }\";; esac; fi",
  "[ -r /etc/dnf/automatic.conf ] && grep -E '^[[:space:]]*(upgrade_type|apply_updates|download_updates)[[:space:]]*=' /etc/dnf/automatic.conf | sed -E 's/^[[:space:]]*/conf /'",
  "command -v apt-config >/dev/null 2>&1 && apt-config dump 2>/dev/null | grep -E '^APT::Periodic::(Unattended-Upgrade|Update-Package-Lists) ' | sed 's/^/apt /'",
  "if [ $SD = yes ]; then for u in dnf-automatic.timer dnf-automatic-install.timer dnf5-automatic.timer apt-daily-upgrade.timer; do e=$(systemctl is-enabled $u 2>/dev/null); [ -n \"$e\" ] && echo \"timer $u $e $(systemctl is-active $u 2>/dev/null)\"; done; fi",
  // fail2ban (fail2ban-client necesita root).
  "echo @@fban",
  "if command -v fail2ban-client >/dev/null 2>&1; then",
  "  if [ \"$ME\" = 0 ]; then o=$($T10 fail2ban-client status 2>&1); printf '%s\\n' \"$o\"",
  "    for j in $(printf '%s\\n' \"$o\" | sed -n 's/.*Jail list:[[:space:]]*//p' | tr ',' ' '); do echo \"@jail $j\"; $T10 fail2ban-client status \"$j\" 2>/dev/null; done",
  "  else echo @noread; fi",
  "else echo @none; fi",
  // sysctl de red (se lee de /proc/sys: no hace falta el programa sysctl).
  "echo @@sysctl",
  `for k in ${SYSCTL_KEYS.map((k) => k.key).join(" ")}; do f=/proc/sys/$(printf '%s' "$k" | tr . /); [ -r "$f" ] && echo "$k=$(cat "$f" 2>/dev/null | tr '\\t' ' ')"; done`,
  "echo @@sysfile",
  `for f in /etc/sysctl.conf /etc/sysctl.d/*.conf; do [ -r "$f" ] && grep -HE '^[[:space:]]*(${KEYS_RE})[[:space:]]*=' "$f" 2>/dev/null; done`,
  "echo @@fstab; grep -E '^[^#]*[[:space:]]/proc[[:space:]]' /etc/fstab 2>/dev/null",
  "echo @@end",
];

const picked = pickSections(AUDIT_SCRIPT, AUDIT_SECTIONS);

/** Las secciones de la Auditoría que no se encontraron (debe quedar vacío: lo comprueban las pruebas). */
export const MISSING_AUDIT_SECTIONS = picked.missing;

export const CONFIG_SCRIPT = [
  // Poca prioridad para no molestar al servidor (los hijos la heredan).
  "renice -n 10 $$ >/dev/null 2>&1; command -v ionice >/dev/null 2>&1 && ionice -c3 -p $$ >/dev/null 2>&1; true",
  ...picked.lines,
  ...OWN,
].join("\n");
