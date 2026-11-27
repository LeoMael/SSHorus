//! Script de `deploy_app`: deja una app en marcha como servicio systemd DEL USUARIO de la app (nunca root):
//! un contenedor de Podman sin root o un programa. Pasos (como root, y lo de la app como ese usuario):
//! comprobar systemd, el usuario y Podman → linger y su systemd → copiar los archivos subidos a
//! `~/apps/<app>` (root lee, el usuario escribe: un enlace en su carpeta no sirve para escribir fuera) →
//! imagen (descargar, construir o cargar) → variables en `~/.config/sshorus/<app>.env` (600) → unidad
//! `~/.config/systemd/user/<app>.service` → activar y reiniciar → estado y, si falla, sus últimos logs.
//! Volver a llamarlo actualiza la app (misma unidad). `remove_script` la para y quita su unidad.

use super::super::template::shell_quote;
pub use super::app_unit::{AppSpec, ImageSource, Run};
use super::{fail, write_lines};

/// Marca del estado final: `@@state=<active|failed|…>`.
pub const STATE_MARK: &str = "@@state=";

/// Comprobaciones y funciones comunes (como root): systemd, usuario, su systemd de usuario y `asu` para
/// ejecutar como él. `podman` = hace falta Podman.
fn prelude(user: &str, podman: bool) -> Vec<String> {
    let mut s = vec![
        "set -e".to_string(),
        "PATH=$PATH:/usr/sbin:/sbin:/usr/local/bin".into(),
        format!("u={}", shell_quote(user)),
        format!(
            "if ! command -v systemctl >/dev/null 2>&1 || [ ! -d /run/systemd/system ]; then {}; fi",
            fail("Este servidor no usa systemd: deploy_app no sirve aquí")
        ),
        format!(
            "if ! id \"$u\" >/dev/null 2>&1; then {}; fi",
            fail("No existe ese usuario: créalo antes con create_app_user")
        ),
        "uid=$(id -u \"$u\")".into(),
        format!(
            "if [ \"$uid\" = 0 ]; then {}; fi",
            fail("No se despliega como root: usa un usuario aparte (create_app_user)")
        ),
        // Solo usuarios normales y sin sudo: ni cuentas del sistema (www-data, nobody…) ni administradores.
        "m=$(awk '$1 == \"UID_MIN\" {print $2}' /etc/login.defs 2>/dev/null); m=${m:-1000}".into(),
        format!(
            "if [ \"$uid\" -lt \"$m\" ]; then {}; fi",
            fail("Es una cuenta del sistema: usa un usuario creado con create_app_user")
        ),
        format!(
            "if id -nG \"$u\" | tr ' ' '\\n' | grep -qxE 'wheel|sudo|admin'; then {}; fi",
            fail("Ese usuario tiene sudo: la app va con un usuario sin sudo (create_app_user)")
        ),
        "h=$(grep \"^$u:\" /etc/passwd | cut -d: -f6)".into(),
        format!(
            "if [ -z \"$h\" ] || [ ! -d \"$h\" ]; then {}; fi",
            fail("Ese usuario no tiene carpeta personal")
        ),
    ];
    if podman {
        s.push(format!(
            "if ! command -v podman >/dev/null 2>&1; then {}; fi",
            fail(
                "Podman no está instalado: instálalo antes (dnf, apt, zypper o apk install podman)"
            )
        ));
    }
    let env = "env HOME=\"$h\" XDG_RUNTIME_DIR=\"/run/user/$uid\" DBUS_SESSION_BUS_ADDRESS=\"unix:path=/run/user/$uid/bus\" sh -c \"$1\"";
    s.extend([
        format!("if command -v runuser >/dev/null 2>&1; then asu() {{ runuser -u \"$u\" -- {env}; }}; else asu() {{ sudo -u \"$u\" -- {env}; }}; fi"),
        "cd /".into(),
        "if command -v loginctl >/dev/null 2>&1; then loginctl enable-linger \"$u\"; fi".into(),
        "i=0; while [ ! -S \"/run/user/$uid/bus\" ] && [ $i -lt 30 ]; do systemctl start \"user@$uid.service\" 2>/dev/null || true; sleep 1; i=$((i+1)); done".into(),
        format!(
            "if [ ! -S \"/run/user/$uid/bus\" ]; then {}; fi",
            fail("No arrancó el systemd de ese usuario. En Debian/Ubuntu instala dbus-user-session (y systemd-container) y vuelve a intentarlo")
        ),
    ]);
    s
}

/// `asu '<inner>'`: ejecutar `inner` como el usuario de la app.
fn asu(inner: &str) -> String {
    format!("asu {}", shell_quote(inner))
}

pub fn deploy_script(spec: &AppSpec) -> String {
    let n = &spec.name;
    let app_dir = format!("\"$HOME/apps/{n}\"");
    let container = matches!(spec.run, Run::Container { .. });
    let mut s = prelude(&spec.user, container);
    let mut dirs = vec![
        app_dir.clone(),
        "\"$HOME/.config/systemd/user\"".into(),
        "\"$HOME/.config/sshorus\"".into(),
    ];
    dirs.extend(
        spec.volumes
            .iter()
            .map(|(d, _)| format!("\"$HOME/apps/{n}/{d}\"")),
    );
    s.push(asu(&format!("mkdir -p {}", dirs.join(" "))));
    if let Some(src) = &spec.copy_from {
        let untar = asu(&format!("tar -C {app_dir} -xf -"));
        s.extend([
            format!("src={}", shell_quote(src)),
            format!(
                "if [ -d \"$src\" ]; then tar -C \"$src\" -cf - . | {untar}; elif [ -f \"$src\" ]; then tar -C \"$(dirname \"$src\")\" -cf - \"$(basename \"$src\")\" | {untar}; else {}; fi",
                fail("No existe la carpeta o el archivo de copy_from en el servidor: súbelo antes con upload")
            ),
        ]);
    }
    if let Run::Container { image, source } = &spec.run {
        match source {
            ImageSource::Pull => s.push(asu(&format!("podman pull {}", shell_quote(image)))),
            ImageSource::Build => s.push(asu(&format!("cd {app_dir} && podman build -t {} .", shell_quote(image)))),
            ImageSource::Archive(f) => s.extend([
                format!("f={}", shell_quote(f)),
                format!("if [ ! -f \"$f\" ]; then {}; fi", fail("No existe el archivo de image_archive en el servidor: súbelo antes con upload")),
                format!("{} < \"$f\"", asu("podman load")),
            ]),
        }
    }
    let env_file = format!("\"$HOME/.config/sshorus/{n}.env\"");
    let env_write = if spec.env.is_empty() {
        format!(": > {env_file}")
    } else {
        write_lines(&spec.env_lines(), &env_file)
    };
    s.push(asu(&format!(
        "umask 077 && {env_write} && chmod 600 {env_file}"
    )));
    s.push(asu(&write_lines(
        &spec.unit_lines(),
        &format!("\"$HOME/.config/systemd/user/{n}.service\""),
    )));
    let unit = spec.unit_name();
    // Si falla, se sigue: el estado y los logs dicen por qué.
    s.push(format!(
        "{} || true",
        asu(&format!("systemctl --user daemon-reload && systemctl --user enable {unit} && systemctl --user restart {unit}"))
    ));
    s.extend(final_state(&unit));
    s.join("\n")
}

/// Estado final y, si no está activa, los últimos logs del usuario (como root: siempre se pueden leer).
fn final_state(unit: &str) -> Vec<String> {
    vec![
        "sleep 3".to_string(),
        format!("st=$({} || true)", asu(&format!("systemctl --user is-active {unit}"))),
        format!("echo \"{STATE_MARK}$st\""),
        "if [ \"$st\" != active ]; then echo '--- Últimos logs ---'; journalctl _UID=\"$uid\" -n 40 --no-pager 2>/dev/null || true; exit 1; fi".into(),
    ]
}

/// Parar y quitar la app: desactiva la unidad y borra la unidad y sus variables. Deja `~/apps/<app>` (código
/// y datos) por si hace falta volver atrás.
pub fn remove_script(user: &str, name: &str) -> String {
    let unit = format!("{name}.service");
    let mut s = prelude(user, false);
    s.push(asu(&format!(
        "systemctl --user disable --now {unit} 2>/dev/null || true; \
         rm -f \"$HOME/.config/systemd/user/{unit}\" \"$HOME/.config/sshorus/{name}.env\"; \
         systemctl --user daemon-reload; systemctl --user reset-failed {unit} 2>/dev/null || true"
    )));
    s.push(format!("echo \"{STATE_MARK}removed\""));
    s.join("\n")
}

/// Estado que dejó el script (`active`, `failed`, `removed`…).
pub fn parse_state(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .rev()
        .find_map(|l| l.strip_prefix(STATE_MARK))
        .map(|s| s.trim().to_string())
}
