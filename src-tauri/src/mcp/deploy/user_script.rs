//! Script de `create_app_user`: un usuario para una app, sin sudo y sin contraseña (nadie entra con ella),
//! con `linger` (sus servicios siguen sin sesión abierta), rangos subuid/subgid (Podman sin root) y la
//! carpeta `~/apps`. Opcional: una llave pública para entrar por SSH. Se ejecuta como root.

use super::super::template::shell_quote;
use super::{fail, write_lines};

/// Marca de la última línea: `@@user=<nombre> uid=<uid> home=<carpeta>`.
pub const DONE_MARK: &str = "@@user=";

/// Pasos (ya validados `name` y `key` con `check`). Falla si el usuario ya existe: nunca toca uno que haya.
pub fn create_user_script(name: &str, key: Option<&str>) -> String {
    let u = shell_quote(name);
    let mut s = vec![
        "set -e".to_string(),
        "PATH=$PATH:/usr/sbin:/sbin".into(),
        format!("u={u}"),
        format!("if id \"$u\" >/dev/null 2>&1; then {}; fi", fail("Ese usuario ya existe: elige otro nombre (no se tocó nada)")),
        "s=/bin/sh; if [ -x /bin/bash ]; then s=/bin/bash; fi".into(),
        // Contraseña «*»: bloqueada sin «!» (así sshd deja entrar con llave). Sin grupos extra: nada de sudo.
        "if command -v useradd >/dev/null 2>&1; then useradd -m -s \"$s\" \"$u\"; usermod -p '*' \"$u\"; \
         else adduser -D -s \"$s\" \"$u\"; printf '%s:*\\n' \"$u\" | chpasswd -e; fi"
            .into(),
        "uid=$(id -u \"$u\"); g=$(id -g \"$u\")".into(),
        "h=$(grep \"^$u:\" /etc/passwd | cut -d: -f6)".into(),
        // useradd moderno ya los añade; en sistemas viejos o busybox, no.
        "for f in /etc/subuid /etc/subgid; do \
         if [ ! -f \"$f\" ]; then : > \"$f\"; fi; \
         if ! grep -q \"^$u:\" \"$f\"; then \
         st=$(awk -F: 'BEGIN{m=100000} {e=$2+$3; if(e>m)m=e} END{print m}' \"$f\"); \
         echo \"$u:$st:65536\" >> \"$f\"; fi; done"
            .into(),
        "install -d -o \"$u\" -g \"$g\" -m 750 \"$h/apps\"".into(),
    ];
    if let Some(k) = key {
        s.push("install -d -o \"$u\" -g \"$g\" -m 700 \"$h/.ssh\"".into());
        s.push(write_lines(&[k.to_string()], "\"$h/.ssh/authorized_keys\""));
        s.push(
            "chown \"$u:$g\" \"$h/.ssh/authorized_keys\"; chmod 600 \"$h/.ssh/authorized_keys\""
                .into(),
        );
    }
    s.push(format!(
        "if command -v loginctl >/dev/null 2>&1; then loginctl enable-linger \"$u\"; else echo {} >&2; fi",
        shell_quote("Sin loginctl (no es systemd): se omite linger; deploy_app necesita systemd")
    ));
    s.push(format!("echo \"{DONE_MARK}$u uid=$uid home=$h\""));
    s.join("\n")
}

/// Datos de la línea final, si el script terminó: (uid, carpeta).
pub fn parse_done(stdout: &str) -> Option<(String, String)> {
    let line = stdout.lines().rev().find(|l| l.starts_with(DONE_MARK))?;
    let uid = line.split(" uid=").nth(1)?.split(' ').next()?.to_string();
    let home = line.split(" home=").nth(1)?.trim().to_string();
    Some((uid, home))
}
