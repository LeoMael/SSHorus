//! El arranque corto que se envía en lugar del comando y la marca de PID que escribe en stderr
//! (para saber qué grupo de procesos detener).

/// Línea que el arranque escribe en stderr: `__SSHORUS_PID__=<pid>`.
const PID_MARK: &[u8] = b"__SSHORUS_PID__=";
/// Si stderr ya tiene esto y aún no apareció la marca, se deja de buscar.
pub(super) const MARK_SEARCH_LIMIT: usize = 64 * 1024;

/// Comando corto que se envía al servidor en lugar del comando real (`len` = bytes del comando real).
///
/// - Va entre comillas simples para el shell de login (bash, zsh, fish, tcsh, dash, busybox…): dentro NO
///   puede haber comillas simples, barras invertidas, «!» ni saltos de línea.
/// - Escribe su PID en stderr. El servidor crea un grupo de procesos nuevo para cada canal y este `sh`
///   suele ser su jefe (bash, zsh y dash le ceden su PID con `exec`; fish y tcsh le dan un grupo propio):
///   todo lo que lance el comando queda en ese grupo.
/// - El comando real llega por stdin: `dd` lee exactamente `len` bytes; lo que venga después en stdin
///   (contraseñas de `execStdin`) queda para el comando.
/// - `exec "$SHELL" -c` ejecuta el comando con el shell de login del usuario, con el mismo PID.
pub fn bootstrap(len: usize) -> String {
    format!(
        "sh -c 'echo __SSHORUS_PID__=$$ >&2; \
         c=$(dd bs=1 count={len} 2>/dev/null); \
         [ -n \"$c\" ] || {{ echo SSHorus: no se pudo leer el comando >&2; exit 127; }}; \
         exec \"${{SHELL:-/bin/sh}}\" -c \"$c\"'"
    )
}

/// Proceso remoto que hay que detener.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RemoteTarget {
    pub pid: u32,
}

impl RemoteTarget {
    /// Script para otro canal: envía `sig` al grupo `-PID` y, si no existe (el proceso no es jefe de
    /// grupo), solo al proceso. Un grupo con ese número solo puede ser el de este comando.
    /// Solo números y palabras fijas: sirve con cualquier shell de login. `kill -SEÑAL -GRUPO` (sin `--`)
    /// funciona en bash, dash y busybox.
    pub fn kill_command(&self, sig: &str) -> String {
        format!("sh -c 'kill -{sig} -{p} 2>/dev/null || kill -{sig} {p} 2>/dev/null; exit 0'", p = self.pid)
    }
}

/// Busca la línea de la marca en `stderr`, la quita y devuelve el PID.
/// None si todavía no está completa (o no es válida: en ese caso no se toca nada).
pub fn take_pid_mark(stderr: &mut Vec<u8>) -> Option<RemoteTarget> {
    let start = stderr.windows(PID_MARK.len()).position(|w| w == PID_MARK)?;
    let rest = &stderr[start + PID_MARK.len()..];
    let nl = rest.iter().position(|&b| b == b'\n')?;
    let text = std::str::from_utf8(&rest[..nl]).ok()?.trim_end_matches('\r');
    let pid = text.trim().parse::<u32>().ok().filter(|&n| n > 1)?;
    stderr.drain(start..start + PID_MARK.len() + nl + 1);
    Some(RemoteTarget { pid })
}
