//! Scripts POSIX (solo lectura) que se ejecutan en el servidor, fase por fase.
//!
//! Están aquí (y no en la interfaz) para que la interfaz, las pruebas y el futuro servidor MCP usen
//! exactamente los mismos. La interfaz los pide con `vulnscan_script` y los ejecuta con `runScript`
//! (con o sin sudo); la salida vuelve al motor en bruto y la leen los parsers de `parse/`.
//!
//! Formato de salida: secciones que empiezan con una línea `@@nombre` y terminan en `@@end`.
//! Ningún script cambia nada en el servidor: listan, leen archivos o montan una imagen y la desmontan.
//!
//! Aquí las fases del sistema (1 a 3); en `images` las de contenedores e imágenes (fase 4), que se
//! ejecutan como el dueño de cada almacén.

mod images;

use super::model::DistroTool;

// Las pruebas de `tests_runtime.rs` los ejecutan en este equipo.
#[cfg(all(test, unix))]
pub(crate) use images::{as_user_script, runtime_fallback};
pub use images::{as_owner_script, image_script, images_list_script, UserCtx};

/// Cita un argumento para un shell POSIX (`'…'`, con `'\''` para las comillas internas).
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Formato de `rpm -qa`: nombre, epoch, versión, release, arquitectura, rpm fuente y vendedor.
pub const RPM_QF: &str = r"%{NAME}\t%{EPOCHNUM}\t%{VERSION}\t%{RELEASE}\t%{ARCH}\t%{SOURCERPM}\t%{VENDOR}\n";

/// Formato de `dpkg-query -W`: estado, paquete, versión, fuente, versión fuente y arquitectura.
pub const DPKG_FMT: &str = r"${db:Status-Abbrev}\t${Package}\t${Version}\t${source:Package}\t${source:Version}\t${Architecture}\n";

/// Plantilla de Trivy: una línea por hallazgo (el JSON completo pasa de 2 MB en imágenes grandes).
/// Columnas: clase, id, paquete, instalada, arreglada, gravedad, estado y ruta (para librerías).
pub const TRIVY_TEMPLATE: &str = "{{- range . }}{{ $c := .Class }}{{- range .Vulnerabilities }}\n\
{{ $c }}\t{{ .VulnerabilityID }}\t{{ .PkgName }}\t{{ .InstalledVersion }}\t{{ .FixedVersion }}\t{{ .Severity }}\t{{ .Status }}\t{{ .PkgPath }}\
{{- end }}{{- end }}\n";

const PATH_LINE: &str = "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin:/usr/local/bin; export PATH; LC_ALL=C; export LC_ALL";

/// Qué gestor de paquetes hay (el primero que responde).
const PM_DETECT: &str = r#"if command -v dpkg-query >/dev/null 2>&1; then PM=dpkg
elif command -v rpm >/dev/null 2>&1 && rpm -q rpm >/dev/null 2>&1; then PM=rpm
elif command -v apk >/dev/null 2>&1; then PM=apk
elif command -v rpm >/dev/null 2>&1; then PM=rpm
else PM=none; fi"#;

/// Fase 1: distro, kernel, usuario, gestor de paquetes y herramientas disponibles. Sin root.
pub fn detect_script() -> String {
    format!(
        r#"{PATH_LINE}
echo @@os; cat /etc/os-release 2>/dev/null || cat /usr/lib/os-release 2>/dev/null
echo @@kernel; uname -srm 2>/dev/null
echo @@id; id -un 2>/dev/null; id -u 2>/dev/null
echo @@container
if [ -f /run/.containerenv ] || [ -f /.dockerenv ]; then echo yes; else echo no; fi
{PM_DETECT}
echo @@pm; echo $PM
echo @@tools
for t in trivy debsecan pro dnf dnf5 yum zypper podman docker runuser sudo rpm; do
  p=$(command -v $t 2>/dev/null) && printf '%s\t%s\n' "$t" "$p"
done
echo @@dnf
if command -v dnf >/dev/null 2>&1; then dnf --version 2>/dev/null | head -n1; fi
echo @@trivy
if command -v trivy >/dev/null 2>&1; then trivy --version 2>/dev/null | head -n1; fi
echo @@pro
if command -v pro >/dev/null 2>&1; then
  if pro status --format json 2>/dev/null | grep -q '"attached": *true'; then echo attached; else echo free; fi
fi
echo @@docker
if command -v docker >/dev/null 2>&1 && docker info --format '{{{{.ServerVersion}}}}' >/dev/null 2>&1; then echo ok; else echo no; fi
echo @@reboot
if [ -f /var/run/reboot-required ]; then echo required; fi
echo @@bootid; cat /proc/sys/kernel/random/boot_id 2>/dev/null
echo @@bootkernel
if command -v grubby >/dev/null 2>&1; then grubby --default-kernel 2>/dev/null | head -n1; fi
echo @@end
"#
    )
}

/// Fase 1b (solo con root o sudo): cuentas con almacén de contenedores propio.
/// Columnas: usuario, uid, home, podman (yes/no), docker rootless (yes/no), /run/user/uid (yes/no).
pub fn users_script() -> String {
    format!(
        r#"{PATH_LINE}
echo @@users
lg=; command -v loginctl >/dev/null 2>&1 && lg=1
{{ getent passwd 2>/dev/null || cat /etc/passwd; }} | while IFS=: read -r u x uid gid g home sh; do
  case $uid in ''|*[!0-9]*) continue ;; esac
  [ "$uid" -ge 1000 ] || continue
  [ "$uid" -ge 65534 ] && continue
  p=no; d=no; r=no
  [ -d "$home/.local/share/containers/storage" ] && p=yes
  [ -d "$home/.local/share/docker" ] && d=yes
  [ -d "/run/user/$uid" ] && r=yes
  [ $p = yes ] || [ $d = yes ] || continue
  l=na; [ -n "$lg" ] && {{ l=no; [ -e "/var/lib/systemd/linger/$u" ] && l=yes; }}
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$u" "$uid" "$home" "$p" "$d" "$r" "$l"
done
echo @@root
if [ -d /var/lib/containers/storage ] && command -v podman >/dev/null 2>&1; then echo podman; fi
if command -v docker >/dev/null 2>&1 && docker info --format '{{{{.ServerVersion}}}}' >/dev/null 2>&1; then echo docker; fi
echo @@end
"#
    )
}

/// Programas clave: nombre y cómo se pide su versión.
const PROGRAMS: &[(&str, &str)] = &[
    ("sudo", "-V 2>/dev/null"),
    ("ssh", "-V 2>&1"),
    ("sshd", "-V 2>&1"),
    ("nginx", "-v 2>&1"),
    ("caddy", "version 2>/dev/null"),
    ("podman", "--version 2>/dev/null"),
    ("docker", "--version 2>/dev/null"),
    ("node", "--version 2>/dev/null"),
    ("python3", "--version 2>&1"),
    ("php", "-v 2>/dev/null"),
    ("java", "-version 2>&1"),
    ("httpd", "-v 2>/dev/null"),
    ("apache2", "-v 2>/dev/null"),
    ("postgres", "--version 2>/dev/null"),
];

/// Fase 2: paquetes del sistema, programas clave (con su paquete dueño) y runtimes de `$HOME`. Sin root.
pub fn inventory_script() -> String {
    let mut progs = String::new();
    for (name, args) in PROGRAMS {
        progs.push_str(&format!(
            "p=$(command -v {name} 2>/dev/null) && {{ r=$(readlink -f \"$p\" 2>/dev/null || echo \"$p\"); \
             v=$(\"$p\" {args} | head -n1); printf '%s\\t%s\\t%s\\t%s\\n' {name} \"$r\" \"$(own \"$r\" \"$p\")\" \"$v\"; }}\n"
        ));
    }
    format!(
        r#"{PATH_LINE}
{PM_DETECT}
echo @@pm; echo $PM
echo @@pkgs
case $PM in
  dpkg) dpkg-query -W -f='{DPKG_FMT}' 2>/dev/null ;;
  rpm) rpm -qa --qf '{RPM_QF}' 2>/dev/null ;;
  apk) apk list -I 2>/dev/null ;;
esac
# Paquete dueño de un binario y su vendedor (RPM) o mantenedor (dpkg): «paquete<TAB>vendedor».
own() {{
  for f in "$1" "$2"; do
    [ -n "$f" ] || continue
    case $PM in
      dpkg)
        o=$(dpkg -S "$f" 2>/dev/null | head -n1 | cut -d: -f1)
        [ -n "$o" ] || o=$(dpkg -S "$(echo "$f" | sed 's#^/usr/#/#')" 2>/dev/null | head -n1 | cut -d: -f1)
        if [ -n "$o" ]; then printf '%s\t%s' "$o" "$(dpkg-query -W -f='${{Maintainer}}' "$o" 2>/dev/null)"; return; fi ;;
      rpm)
        if o=$(rpm -qf --qf '%{{NAME}}\t%{{VENDOR}}\n' "$f" 2>/dev/null); then printf '%s' "$(echo "$o" | head -n1)"; return; fi ;;
      apk)
        o=$(apk info --who-owns "$f" 2>/dev/null | sed -n 's/.* is owned by //p' | head -n1)
        if [ -n "$o" ]; then printf '%s\t' "$o"; return; fi ;;
    esac
  done
  printf '\t'
}}
echo @@tools
{progs}echo @@home
for d in "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.volta/tools/image/node/*/bin/node \
  "$HOME"/.pyenv/versions/*/bin/python3 "$HOME"/.sdkman/candidates/java/*/bin/java \
  /usr/local/bin/node /usr/local/bin/python3 /usr/local/bin/php /opt/*/bin/java /opt/*/bin/node; do
  [ -x "$d" ] || continue
  case $d in
    */node) v=$("$d" --version 2>/dev/null | head -n1); k=node ;;
    */python3) v=$("$d" --version 2>&1 | head -n1); k=python3 ;;
    */java) v=$("$d" -version 2>&1 | head -n1); k=java ;;
    */php) v=$("$d" -v 2>/dev/null | head -n1); k=php ;;
    *) continue ;;
  esac
  printf '%s\t%s\t%s\t%s\n' "$k" "$d" "$(own "$d" "")" "$v"
done
echo @@end
"#
    )
}

/// Qué versiones nuevas ofrecen los repositorios (`repo.rs`): 100 = hay, 0 = ninguna, otro = error.
fn check_update(cmd: &str) -> String {
    format!("echo @@upgrades\n{cmd} -q check-update 2>/dev/null\necho \"@@uprc $?\"")
}

/// Fase 3: herramienta de seguridad de la distro (`codename` solo para debsecan). Sin root.
pub fn distro_script(tool: DistroTool, codename: &str) -> String {
    let body = match tool {
        DistroTool::Dnf4 | DistroTool::Yum => {
            let cmd = if tool == DistroTool::Yum { "yum" } else { "dnf" };
            let sec = if tool == DistroTool::Yum { "security" } else { "--security" };
            format!(
                "echo @@list\n{cmd} -q updateinfo list {sec} 2>/dev/null\necho \"@@rc $?\"\n\
                 echo @@info\n{cmd} -q updateinfo info {sec} 2>/dev/null\necho \"@@rc $?\"\n{CHECK_UPDATE}",
                CHECK_UPDATE = check_update(cmd)
            )
        }
        DistroTool::Dnf5 => format!(
            "echo @@list\ndnf -q advisory list --security --json 2>/dev/null\necho \"@@rc $?\"\n\
             echo @@info\ndnf -q advisory info --security --json 2>/dev/null\necho \"@@rc $?\"\n{}",
            check_update("dnf")
        ),
        DistroTool::Debsecan => {
            let suite = if codename.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && !codename.is_empty() {
                format!(" --suite {codename}")
            } else {
                String::new()
            };
            format!("echo @@debsecan\ndebsecan{suite} --format detail 2>/dev/null\necho \"@@rc $?\"")
        }
        DistroTool::Pro => "echo @@pro\npro api u.pro.security.cves.v1 2>/dev/null\necho \"@@rc $?\"".to_string(),
        DistroTool::Zypper => "echo @@zypper\nzypper --non-interactive --xmlout list-patches --category security 2>/dev/null\n\
             echo \"@@rc $?\""
            .to_string(),
    };
    format!("{PATH_LINE}\n{body}\necho @@end\n")
}
