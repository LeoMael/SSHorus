//! Dónde están los asistentes de IA de línea de comandos y la shell del sistema: búsqueda en el
//! `PATH` y en las carpetas habituales (también las de sus instaladores), y cómo se arrancan.
//!
//! Todo es lógica pura (sin tocar el disco salvo por la función `is_file` que se inyecta), así se
//! prueba igual en Linux, macOS y Windows. Qué asistentes hay y cómo se abren: `tools.rs` y `args.rs`.

use std::path::{Path, PathBuf};

use super::tools::{AiTool, NpmShim, TOOLS};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Linux,
    Mac,
    Windows,
}

impl Os {
    pub fn current() -> Os {
        if cfg!(windows) {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::Mac
        } else {
            Os::Linux
        }
    }
}

/// Lo necesario para buscar programas (inyectable en las pruebas).
#[derive(Debug, Clone)]
pub struct SearchEnv {
    pub os: Os,
    /// Carpetas de `PATH`, en orden.
    pub path: Vec<PathBuf>,
    pub home: Option<PathBuf>,
    /// Windows: `%APPDATA%` y `%LOCALAPPDATA%`.
    pub appdata: Option<PathBuf>,
    pub local_appdata: Option<PathBuf>,
    /// Carpetas `bin` de las versiones de Node instaladas con nvm (la más nueva primero).
    pub nvm_bins: Vec<PathBuf>,
}

impl SearchEnv {
    /// Carpetas habituales que no siempre están en el `PATH` de una app abierta desde el escritorio.
    pub fn extra_dirs(&self) -> Vec<PathBuf> {
        let mut v = Vec::new();
        match self.os {
            Os::Windows => {
                if let Some(h) = &self.home {
                    v.push(h.join(".local").join("bin"));
                }
                if let Some(a) = &self.appdata {
                    v.push(a.join("npm"));
                }
                if let Some(l) = &self.local_appdata {
                    v.push(l.join("Programs").join("nodejs"));
                }
                v.push(PathBuf::from(r"C:\Program Files\nodejs"));
                v.extend(self.installer_dirs());
            }
            Os::Linux | Os::Mac => {
                if let Some(h) = &self.home {
                    for d in [".local/bin", "bin", ".npm-global/bin", ".volta/bin", ".bun/bin", ".yarn/bin"] {
                        v.push(h.join(d));
                    }
                }
                v.extend(self.installer_dirs());
                v.extend(self.nvm_bins.iter().cloned());
                if self.os == Os::Mac {
                    v.push(PathBuf::from("/opt/homebrew/bin"));
                }
                v.push(PathBuf::from("/usr/local/bin"));
                v.push(PathBuf::from("/usr/bin"));
            }
        }
        v
    }

    /// Carpetas donde dejan los programas los instaladores de los asistentes (tabla `TOOLS`).
    fn installer_dirs(&self) -> Vec<PathBuf> {
        let windows = self.os == Os::Windows;
        let base = if windows { self.local_appdata.as_ref() } else { self.home.as_ref() };
        let Some(base) = base else { return Vec::new() };
        TOOLS
            .iter()
            .flat_map(|t| if windows { t.local_appdata_dirs } else { t.home_dirs })
            .map(|rel| rel.split('/').fold(base.clone(), |p, part| p.join(part)))
            .collect()
    }

    /// `PATH` primero y luego las carpetas habituales (sin repetir).
    pub fn search_dirs(&self) -> Vec<PathBuf> {
        let mut out: Vec<PathBuf> = Vec::new();
        for d in self.path.iter().cloned().chain(self.extra_dirs()) {
            if !d.as_os_str().is_empty() && !out.contains(&d) {
                out.push(d);
            }
        }
        out
    }

    fn names(&self, base: &str) -> Vec<String> {
        match self.os {
            Os::Windows => vec![format!("{base}.exe"), format!("{base}.cmd")],
            _ => vec![base.to_string()],
        }
    }
}

/// Primer programa `base` en las carpetas de búsqueda.
pub fn find_program(env: &SearchEnv, base: &str, is_file: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    let names = env.names(base);
    for dir in env.search_dirs() {
        for n in &names {
            let p = dir.join(n);
            if is_file(&p) {
                return Some(p);
            }
        }
    }
    None
}

/// Cómo se arranca un programa encontrado.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    /// Programa a ejecutar.
    pub program: PathBuf,
    /// Argumentos que van antes de los nuestros (p. ej. el `.js` cuando se lanza con node).
    pub prefix: Vec<String>,
    /// Ruta que se muestra al usuario.
    pub shown: PathBuf,
}

/// Busca el asistente. En Windows, si solo está el `.cmd` de npm, se lanza lo que hay detrás:
/// su `.js` con node, o su ejecutable (un `.cmd` no se puede lanzar directamente y pasarle textos
/// largos por cmd.exe no es seguro).
pub fn resolve_tool(env: &SearchEnv, tool: AiTool, is_file: &dyn Fn(&Path) -> bool) -> Option<Resolved> {
    let spec = tool.spec();
    let found = find_program(env, spec.program, is_file)?;
    let is_cmd = found.extension().is_some_and(|e| e.eq_ignore_ascii_case("cmd"));
    if !is_cmd {
        return Some(Resolved { program: found.clone(), prefix: Vec::new(), shown: found });
    }
    let modules = found.parent()?.join("node_modules");
    let in_modules = |parts: &[&str]| parts.iter().fold(modules.clone(), |p, x| p.join(x));
    match spec.npm_shim? {
        NpmShim::Js(parts) => {
            let js = in_modules(parts);
            let node = find_program(env, "node", is_file)?;
            is_file(&js).then(|| Resolved { program: node, prefix: vec![js.display().to_string()], shown: found.clone() })
        }
        NpmShim::Exe(parts) => {
            let exe = in_modules(parts);
            is_file(&exe).then(|| Resolved { program: exe, prefix: Vec::new(), shown: found.clone() })
        }
    }
}

/// `PATH` para los procesos de la terminal local: el actual más las carpetas habituales que
/// existan (y las de los programas encontrados), sin repetir y sin cambiar el orden del usuario.
pub fn augmented_path(env: &SearchEnv, also: &[PathBuf], is_dir: &dyn Fn(&Path) -> bool) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for d in &env.path {
        if !d.as_os_str().is_empty() && !out.contains(d) {
            out.push(d.clone());
        }
    }
    for d in also.iter().cloned().chain(env.extra_dirs()) {
        if !out.contains(&d) && is_dir(&d) {
            out.push(d);
        }
    }
    out
}

// ───────────────────────── Shell por defecto ─────────────────────────

/// Shell del sistema y sus argumentos. Unix: `$SHELL` como shell de inicio de sesión (carga el
/// `PATH` del perfil). Windows: PowerShell 7 si está, si no Windows PowerShell.
pub fn default_shell(
    os: Os,
    shell_var: Option<&str>,
    pwsh: Option<PathBuf>,
    is_file: &dyn Fn(&Path) -> bool,
) -> (PathBuf, Vec<String>) {
    match os {
        Os::Windows => {
            let p = pwsh.unwrap_or_else(|| PathBuf::from("powershell.exe"));
            (p, vec!["-NoLogo".into()])
        }
        Os::Linux | Os::Mac => {
            let sh = shell_var
                .map(str::trim)
                .filter(|s| !s.is_empty() && is_file(Path::new(s)))
                .map(PathBuf::from)
                .or_else(|| {
                    ["/bin/bash", "/usr/bin/bash", "/bin/zsh", "/bin/sh"]
                        .iter()
                        .map(PathBuf::from)
                        .find(|p| is_file(p))
                })
                .unwrap_or_else(|| PathBuf::from("/bin/sh"));
            (sh, vec!["-l".into()])
        }
    }
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))] // solo Linux tiene /proc
/// Sesión de un proceso a partir de `/proc/<pid>/stat` (campo 6). El nombre va entre paréntesis
/// y puede llevar espacios, por eso se cuenta desde el último `)`.
pub fn stat_session(stat: &str) -> Option<i32> {
    let rest = &stat[stat.rfind(')')? + 1..];
    // Tras el nombre: estado(3) ppid(4) pgrp(5) session(6).
    rest.split_whitespace().nth(3)?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn env(os: Os, path: &[&str]) -> SearchEnv {
        SearchEnv {
            os,
            path: path.iter().map(PathBuf::from).collect(),
            home: Some(PathBuf::from(if os == Os::Windows { r"C:\Users\ana" } else { "/home/ana" })),
            appdata: (os == Os::Windows).then(|| PathBuf::from(r"C:\Users\ana\AppData\Roaming")),
            local_appdata: (os == Os::Windows).then(|| PathBuf::from(r"C:\Users\ana\AppData\Local")),
            nvm_bins: Vec::new(),
        }
    }

    fn files(list: &[&str]) -> impl Fn(&Path) -> bool + use<> {
        let set: HashSet<PathBuf> = list.iter().map(PathBuf::from).collect();
        move |p: &Path| set.contains(p)
    }

    #[test]
    fn encuentra_en_path_antes_que_en_las_habituales() {
        let e = env(Os::Linux, &["/usr/bin", "/opt/x"]);
        let f = files(&["/opt/x/claude", "/home/ana/.local/bin/claude"]);
        assert_eq!(find_program(&e, "claude", &f), Some(PathBuf::from("/opt/x/claude")));
    }

    #[test]
    fn encuentra_en_local_bin_aunque_no_este_en_path() {
        // Una app abierta desde el escritorio no siempre tiene ~/.local/bin en el PATH.
        let e = env(Os::Linux, &["/usr/bin"]);
        let f = files(&["/home/ana/.local/bin/claude", "/home/ana/.local/bin/codex"]);
        let r = resolve_tool(&e, AiTool::Claude, &f).unwrap();
        assert_eq!(r.program, PathBuf::from("/home/ana/.local/bin/claude"));
        assert!(r.prefix.is_empty());
        assert!(resolve_tool(&e, AiTool::Codex, &f).is_some());
    }

    #[test]
    fn no_instalado() {
        let e = env(Os::Mac, &["/usr/bin"]);
        assert!(resolve_tool(&e, AiTool::Codex, &files(&[])).is_none());
    }

    #[test]
    fn nvm_y_homebrew() {
        let mut e = env(Os::Mac, &["/usr/bin"]);
        e.nvm_bins = vec![PathBuf::from("/home/ana/.nvm/versions/node/v22.1.0/bin")];
        let f = files(&["/home/ana/.nvm/versions/node/v22.1.0/bin/codex", "/opt/homebrew/bin/node"]);
        assert_eq!(
            find_program(&e, "codex", &f),
            Some(PathBuf::from("/home/ana/.nvm/versions/node/v22.1.0/bin/codex"))
        );
        assert_eq!(find_program(&e, "node", &f), Some(PathBuf::from("/opt/homebrew/bin/node")));
    }

    #[test]
    fn windows_exe_y_cmd_de_npm() {
        let e = env(Os::Windows, &[r"C:\Windows\System32"]);
        let local = PathBuf::from(r"C:\Users\ana").join(".local").join("bin").join("claude.exe");
        let f = files(&[local.to_str().unwrap()]);
        let r = resolve_tool(&e, AiTool::Claude, &f).unwrap();
        assert_eq!(r.program, local);

        // Codex instalado con npm: se lanza su .js con node.
        let npm = PathBuf::from(r"C:\Users\ana\AppData\Roaming").join("npm");
        let cmd = npm.join("codex.cmd");
        let js = npm.join("node_modules").join("@openai").join("codex").join("bin").join("codex.js");
        let node = PathBuf::from(r"C:\Program Files\nodejs").join("node.exe");
        let f = files(&[cmd.to_str().unwrap(), js.to_str().unwrap(), node.to_str().unwrap()]);
        let r = resolve_tool(&e, AiTool::Codex, &f).unwrap();
        assert_eq!(r.program, node);
        assert_eq!(r.prefix, vec![js.display().to_string()]);
        assert_eq!(r.shown, cmd);

        // Sin node no se puede lanzar el .cmd.
        let f = files(&[cmd.to_str().unwrap(), js.to_str().unwrap()]);
        assert!(resolve_tool(&e, AiTool::Codex, &f).is_none());
    }

    #[test]
    fn carpetas_de_los_instaladores() {
        // OpenCode se instala en ~/.opencode/bin; agy en ~/.local/bin (ya habitual).
        let e = env(Os::Linux, &["/usr/bin"]);
        let f = files(&["/home/ana/.opencode/bin/opencode", "/home/ana/.local/bin/agy"]);
        assert_eq!(resolve_tool(&e, AiTool::OpenCode, &f).unwrap().program, PathBuf::from("/home/ana/.opencode/bin/opencode"));
        assert_eq!(resolve_tool(&e, AiTool::Agy, &f).unwrap().program, PathBuf::from("/home/ana/.local/bin/agy"));

        // Windows: agy en %LOCALAPPDATA%\agy\bin.
        let e = env(Os::Windows, &[r"C:\Windows\System32"]);
        let agy = PathBuf::from(r"C:\Users\ana\AppData\Local").join("agy").join("bin").join("agy.exe");
        let r = resolve_tool(&e, AiTool::Agy, &files(&[agy.to_str().unwrap()])).unwrap();
        assert_eq!(r.program, agy);
    }

    #[test]
    fn windows_cmd_de_npm_con_ejecutable() {
        // OpenCode instalado con npm: el .cmd lleva a un .exe, que se lanza directamente (sin node).
        let e = env(Os::Windows, &[r"C:\Windows\System32"]);
        let npm = PathBuf::from(r"C:\Users\ana\AppData\Roaming").join("npm");
        let cmd = npm.join("opencode.cmd");
        let exe = npm.join("node_modules").join("@opencode").join("cli").join("bin").join("opencode.exe");
        let r = resolve_tool(&e, AiTool::OpenCode, &files(&[cmd.to_str().unwrap(), exe.to_str().unwrap()])).unwrap();
        assert_eq!(r.program, exe);
        assert!(r.prefix.is_empty());
        assert_eq!(r.shown, cmd);
        // agy no tiene paquete de npm: un .cmd suelto no sirve.
        let agy_cmd = npm.join("agy.cmd");
        assert!(resolve_tool(&e, AiTool::Agy, &files(&[agy_cmd.to_str().unwrap()])).is_none());
    }

    #[test]
    fn path_aumentado_sin_repetir() {
        let e = env(Os::Linux, &["/usr/bin", "/home/ana/.local/bin"]);
        let dirs = |p: &Path| p == Path::new("/home/ana/.local/bin") || p == Path::new("/opt/node/bin") || p == Path::new("/usr/local/bin");
        let p = augmented_path(&e, &[PathBuf::from("/opt/node/bin")], &dirs);
        assert_eq!(
            p,
            vec![
                PathBuf::from("/usr/bin"),
                PathBuf::from("/home/ana/.local/bin"),
                PathBuf::from("/opt/node/bin"),
                PathBuf::from("/usr/local/bin"),
            ]
        );
    }

    #[test]
    fn shell_por_defecto() {
        let f = files(&["/usr/bin/zsh", "/bin/bash"]);
        assert_eq!(default_shell(Os::Linux, Some("/usr/bin/zsh"), None, &f).0, PathBuf::from("/usr/bin/zsh"));
        assert_eq!(default_shell(Os::Linux, Some("/no/existe"), None, &f).0, PathBuf::from("/bin/bash"));
        assert_eq!(default_shell(Os::Mac, None, None, &f).1, vec!["-l".to_string()]);
        let (p, a) = default_shell(Os::Windows, None, Some(PathBuf::from(r"C:\pwsh\pwsh.exe")), &f);
        assert_eq!(p, PathBuf::from(r"C:\pwsh\pwsh.exe"));
        assert_eq!(a, vec!["-NoLogo".to_string()]);
        assert_eq!(default_shell(Os::Windows, None, None, &f).0, PathBuf::from("powershell.exe"));
    }

    #[test]
    fn sesion_desde_stat() {
        assert_eq!(stat_session("1234 (bash) S 1 1234 1234 34816 1234 4194560"), Some(1234));
        assert_eq!(stat_session("99 (mi (raro) prog) R 5 77 88 0"), Some(88));
        assert_eq!(stat_session("basura"), None);
    }
}
