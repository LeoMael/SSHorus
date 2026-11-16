//! Qué hace ahora la shell de una pestaña local: en qué carpeta está y si tiene un programa en
//! primer plano. Lo usa «Asistente con contexto» para abrir el asistente en la carpeta donde el
//! usuario hizo `cd` y no encima de otro programa.
//!
//! Linux lo lee de `/proc`; macOS pregunta la carpeta a `lsof`; en Windows no se sabe (None).

use serde::Serialize;
use tauri::State;

use super::LocalTermStore;
use crate::error::AppResult;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTermState {
    /// Carpeta actual de la shell (None = no se sabe).
    pub cwd: Option<String>,
    /// La shell está ejecutando otro programa en primer plano (None = no se sabe).
    pub busy: Option<bool>,
}

/// Grupo de procesos en primer plano de la terminal (campo 8 de `/proc/<pid>/stat`).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn stat_tpgid(stat: &str) -> Option<i32> {
    let rest = &stat[stat.rfind(')')? + 1..];
    // Tras el nombre: estado(3) ppid(4) pgrp(5) session(6) tty_nr(7) tpgid(8).
    rest.split_whitespace().nth(5)?.parse().ok()
}

/// Carpeta en la salida de `lsof -a -p PID -d cwd -Fn` (la línea que empieza por `n`).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn lsof_cwd(out: &str) -> Option<String> {
    out.lines().find_map(|l| l.strip_prefix('n')).filter(|p| p.starts_with('/')).map(str::to_string)
}

#[cfg(target_os = "linux")]
fn read_state(pid: u32) -> LocalTermState {
    let cwd = std::fs::read_link(format!("/proc/{pid}/cwd")).ok().map(|p| p.display().to_string());
    let busy = std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|s| stat_tpgid(&s))
        // portable-pty hace a la shell líder de su grupo: si el de primer plano es otro, hay un programa.
        .map(|tpgid| tpgid > 0 && tpgid != pid as i32);
    LocalTermState { cwd, busy }
}

#[cfg(target_os = "macos")]
fn read_state(pid: u32) -> LocalTermState {
    let out = std::process::Command::new("lsof")
        .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok();
    let cwd = out.and_then(|o| lsof_cwd(&String::from_utf8_lossy(&o.stdout)));
    LocalTermState { cwd, busy: None }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn read_state(_pid: u32) -> LocalTermState {
    LocalTermState::default()
}

/// Carpeta actual de la shell y si está ocupada con otro programa.
#[tauri::command]
pub async fn local_term_state(terms: State<'_, LocalTermStore>, term_id: String) -> AppResult<LocalTermState> {
    let Some(pid) = terms.get(&term_id)?.pid() else { return Ok(LocalTermState::default()) };
    Ok(tokio::task::spawn_blocking(move || read_state(pid)).await.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grupo_en_primer_plano() {
        // Nombre con espacios y paréntesis: se cuenta desde el último «)».
        let stat = "4242 (mi (shell) x) S 1 4242 4242 34816 5001 4194560 0 0";
        assert_eq!(stat_tpgid(stat), Some(5001));
        assert_eq!(stat_tpgid("basura"), None);
    }

    #[test]
    fn carpeta_de_lsof() {
        assert_eq!(lsof_cwd("p123\nfcwd\nn/Users/ana/proyecto\n"), Some("/Users/ana/proyecto".into()));
        assert_eq!(lsof_cwd("p123\n"), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn estado_de_una_shell_real() {
        use std::sync::mpsc;
        use std::time::Duration;
        let dir = std::env::temp_dir();
        let mut cmd = portable_pty::CommandBuilder::new("/bin/sh");
        cmd.cwd(&dir);
        let (etx, erx) = mpsc::channel::<Option<u32>>();
        let t = super::super::pty::spawn(cmd, 80, 24, |_| {}, move |c| {
            let _ = etx.send(c);
        })
        .unwrap();
        let pid = t.pid().expect("sin pid");
        let mut st = LocalTermState::default();
        for _ in 0..40 {
            st = read_state(pid);
            if st.busy == Some(false) {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let want = std::fs::canonicalize(&dir).unwrap().display().to_string();
        assert_eq!(st.cwd.as_deref(), Some(want.as_str()));
        assert_eq!(st.busy, Some(false), "una shell en espera no está ocupada");
        t.write(b"sleep 5\n".to_vec()).unwrap();
        let mut busy = false;
        for _ in 0..60 {
            if read_state(pid).busy == Some(true) {
                busy = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        t.close();
        let _ = erx.recv_timeout(Duration::from_secs(10));
        assert!(busy, "con «sleep» en primer plano debería estar ocupada");
    }
}
