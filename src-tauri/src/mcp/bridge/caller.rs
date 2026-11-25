//! Quién lanzó al puente: la cadena de procesos padre (programa, pid, carpeta), del más cercano al más
//! lejano. Sirve para saber qué asistente pide emparejarse y, al arrancar, de quién es el token.
//!
//! - Linux: `/proc/<pid>/{stat,cmdline,cwd}`.
//! - macOS y Windows: la tabla de procesos de `ps` o de PowerShell (mejor esfuerzo; sin ella, la cadena
//!   queda vacía y vale `--client` o `SSHORUS_MCP_CLIENT`).
//!
//! Es información del sistema local, no una prueba: la app la muestra como tal y la decisión es tuya.
//! Los análisis de texto son funciones puras (se prueban con ejemplos de `/proc`, `ps` y PowerShell).

use std::collections::HashMap;

/// Hasta dónde se sube (shell → asistente → terminal → sesión…).
const MAX_DEPTH: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ProcInfo {
    pub pid: u32,
    pub ppid: u32,
    /// Nombre corto del programa (`comm` en Linux).
    pub name: String,
    /// Línea de comandos (puede faltar si el sistema no la da).
    pub args: Vec<String>,
    pub cwd: Option<String>,
}

impl ProcInfo {
    /// Línea de comandos para mostrar, recortada.
    pub fn command_line(&self) -> String {
        let line = if self.args.is_empty() { self.name.clone() } else { self.args.join(" ") };
        line.chars().take(200).collect()
    }
}

/// Padres de este proceso, del más cercano al más lejano (sin este proceso).
pub fn parent_chain() -> Vec<ProcInfo> {
    let me = std::process::id();
    #[cfg(target_os = "linux")]
    {
        walk(me, linux::read)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let table = table::load();
        walk(me, |pid| table.get(&pid).cloned())
    }
}

/// Sube desde `start` con `read` hasta `MAX_DEPTH` padres, sin repetir (evita bucles) y sin el pid 0/1.
pub fn walk(start: u32, read: impl Fn(u32) -> Option<ProcInfo>) -> Vec<ProcInfo> {
    let mut out = Vec::new();
    let Some(mut cur) = read(start) else { return out };
    let mut seen = vec![start];
    while out.len() < MAX_DEPTH && cur.ppid > 1 && !seen.contains(&cur.ppid) {
        seen.push(cur.ppid);
        match read(cur.ppid) {
            Some(p) => {
                out.push(p.clone());
                cur = p;
            }
            None => break,
        }
    }
    out
}

/// `/proc/<pid>/stat`: (nombre, ppid). El nombre va entre paréntesis y puede tener espacios o «)».
pub fn parse_proc_stat(stat: &str) -> Option<(String, u32)> {
    let open = stat.find('(')?;
    let close = stat.rfind(')')?;
    let name = stat.get(open + 1..close)?.to_string();
    let mut rest = stat.get(close + 1..)?.split_whitespace();
    let _state = rest.next()?;
    let ppid = rest.next()?.parse().ok()?;
    Some((name, ppid))
}

/// `/proc/<pid>/cmdline`: argumentos separados por NUL.
pub fn parse_cmdline(raw: &[u8]) -> Vec<String> {
    raw.split(|b| *b == 0).filter(|a| !a.is_empty()).map(|a| String::from_utf8_lossy(a).into_owned()).collect()
}

/// Separa una línea de comandos en palabras (espacios; respeta comillas dobles, como en Windows).
fn split_words(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for c in line.chars() {
        match c {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Salida de `ps -axww -o pid=,ppid=,command=` (macOS): «pid ppid línea de comandos».
pub fn parse_ps(out: &str) -> HashMap<u32, ProcInfo> {
    out.lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            let pid = it.next()?.parse().ok()?;
            let ppid = it.next()?.parse().ok()?;
            let args: Vec<String> = it.map(str::to_string).collect();
            let name = args.first().map(|a| base_name(a)).unwrap_or_default();
            Some((pid, ProcInfo { pid, ppid, name, args, cwd: None }))
        })
        .collect()
}

/// Salida de PowerShell (Windows): «pid<TAB>ppid<TAB>nombre<TAB>línea de comandos» por línea.
pub fn parse_tabbed(out: &str) -> HashMap<u32, ProcInfo> {
    out.lines()
        .filter_map(|l| {
            let mut it = l.trim_end_matches('\r').splitn(4, '\t');
            let pid = it.next()?.trim().parse().ok()?;
            let ppid = it.next()?.trim().parse().ok()?;
            let name = it.next()?.trim().to_string();
            let args = split_words(it.next().unwrap_or(""));
            Some((pid, ProcInfo { pid, ppid, name, args, cwd: None }))
        })
        .collect()
}

/// «/usr/bin/node» → «node»; «C:\…\claude.exe» → «claude.exe».
pub fn base_name(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

#[cfg(target_os = "linux")]
mod linux {
    use super::{parse_cmdline, parse_proc_stat, ProcInfo};

    pub fn read(pid: u32) -> Option<ProcInfo> {
        let dir = std::path::PathBuf::from(format!("/proc/{pid}"));
        let (name, ppid) = parse_proc_stat(&std::fs::read_to_string(dir.join("stat")).ok()?)?;
        let args = std::fs::read(dir.join("cmdline")).map(|b| parse_cmdline(&b)).unwrap_or_default();
        let cwd = std::fs::read_link(dir.join("cwd")).ok().map(|p| p.display().to_string());
        Some(ProcInfo { pid, ppid, name, args, cwd })
    }
}

#[cfg(not(target_os = "linux"))]
mod table {
    use std::collections::HashMap;
    use std::process::Command;

    use super::ProcInfo;

    #[cfg(target_os = "macos")]
    pub fn load() -> HashMap<u32, ProcInfo> {
        Command::new("ps")
            .args(["-axww", "-o", "pid=,ppid=,command="])
            .output()
            .map(|o| super::parse_ps(&String::from_utf8_lossy(&o.stdout)))
            .unwrap_or_default()
    }

    #[cfg(windows)]
    pub fn load() -> HashMap<u32, ProcInfo> {
        const SCRIPT: &str = "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)`t$($_.CommandLine)\" }";
        Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
            .output()
            .map(|o| super::parse_tabbed(&String::from_utf8_lossy(&o.stdout)))
            .unwrap_or_default()
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    pub fn load() -> HashMap<u32, ProcInfo> {
        HashMap::new()
    }
}
