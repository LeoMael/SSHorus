//! Qué no se sincroniza: carpetas pesadas, temporales de editores, `.sshorusignore` y la lista
//! del diálogo.
//!
//! Patrones (una versión pequeña de `.gitignore`, sin `!` ni `**`):
//! - `nombre` o `*.ext`: cualquier archivo o carpeta con ese nombre, a cualquier profundidad.
//! - `carpeta/`: solo carpetas.
//! - `ruta/dentro`: con `/` en medio, la ruta completa desde la carpeta unida (`/build` = solo arriba).
//! - `*` (sin cruzar `/`) y `?` como comodines; `#` empieza un comentario.

/// Nombre del archivo de patrones dentro de la carpeta del PC.
pub const IGNORE_FILE: &str = ".sshorusignore";

/// Siempre se ignoran (control de versiones, dependencias y temporales de editores).
pub const DEFAULT_IGNORE: &[&str] = &[
    ".git/",
    ".hg/",
    ".svn/",
    "node_modules/",
    IGNORE_FILE,
    ".DS_Store",
    "Thumbs.db",
    "*.swp",
    "*.swo",
    "*.swx",
    "*~",
    ".#*",
    "#*#",
    "4913",
    ".~lock.*",
    "*.crdownload",
    "*.part",
];

#[derive(Debug, Clone)]
struct Rule {
    glob: String,
    dir_only: bool,
    /// Con `/` en medio: se compara con la ruta completa.
    anchored: bool,
}

#[derive(Debug, Clone, Default)]
pub struct IgnoreRules {
    rules: Vec<Rule>,
}

impl IgnoreRules {
    /// Los fijos más los del usuario (`.sshorusignore` y diálogo).
    pub fn new<S: AsRef<str>>(user: &[S]) -> IgnoreRules {
        let mut rules = IgnoreRules::default();
        for p in DEFAULT_IGNORE {
            rules.add(p);
        }
        for p in user {
            rules.add(p.as_ref());
        }
        rules
    }

    fn add(&mut self, raw: &str) {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('!') {
            return;
        }
        let dir_only = line.ends_with('/');
        let body = line.trim_end_matches('/');
        let anchored = body.contains('/');
        let glob = body.trim_start_matches('/').to_string();
        if !glob.is_empty() {
            self.rules.push(Rule { glob, dir_only, anchored });
        }
    }

    /// `rel`: ruta relativa con `/`. `is_dir`: es una carpeta.
    pub fn is_ignored(&self, rel: &str, is_dir: bool) -> bool {
        let name = rel.rsplit('/').next().unwrap_or(rel);
        self.rules.iter().any(|r| {
            if r.dir_only && !is_dir {
                return false;
            }
            if r.anchored {
                glob_match(&r.glob, rel)
            } else {
                glob_match(&r.glob, name)
            }
        })
    }
}

/// Patrones de un `.sshorusignore` (líneas tal cual; `add` limpia comentarios y vacías).
pub fn parse_ignore_file(text: &str) -> Vec<String> {
    text.lines().map(str::to_string).collect()
}

/// `*` = cualquier cosa sin `/`; `?` = un carácter que no sea `/`.
pub fn glob_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let mut star: Option<(usize, usize)> = None;
    while ti < t.len() {
        if pi < p.len() && (p[pi] == t[ti] || (p[pi] == '?' && t[ti] != '/')) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some((pi, ti));
            pi += 1;
        } else if let Some((sp, st)) = star
            && t[st] != '/'
        {
            pi = sp + 1;
            ti = st + 1;
            star = Some((sp, st + 1));
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|c| *c == '*')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_basics() {
        assert!(glob_match("*.swp", ".index.html.swp"));
        assert!(glob_match("*~", "index.html~"));
        assert!(glob_match(".#*", ".#index.html"));
        assert!(glob_match("#*#", "#notas.txt#"));
        assert!(glob_match("a?c", "abc"));
        assert!(!glob_match("a?c", "a/c"));
        assert!(!glob_match("*.css", "estilo.css.map"));
        assert!(glob_match("build/*.js", "build/app.js"));
        assert!(!glob_match("build/*.js", "build/sub/app.js"));
        assert!(glob_match("*", "loquesea"));
    }

    #[test]
    fn defaults_skip_vcs_deps_and_editor_temps() {
        let r = IgnoreRules::new::<&str>(&[]);
        assert!(r.is_ignored(".git", true));
        assert!(r.is_ignored("web/node_modules", true));
        assert!(r.is_ignored("src/.app.js.swp", false));
        assert!(r.is_ignored("src/app.js~", false));
        assert!(r.is_ignored(".#app.js", false));
        assert!(r.is_ignored("4913", false));
        assert!(r.is_ignored(IGNORE_FILE, false));
        assert!(!r.is_ignored("src/app.js", false));
        assert!(!r.is_ignored(".gitignore", false));
        assert!(!r.is_ignored(".htaccess", false));
        // «.git/» solo vale para carpetas.
        assert!(!r.is_ignored(".git", false));
    }

    #[test]
    fn user_patterns() {
        let r = IgnoreRules::new(&["# comentario", "", "*.log", "dist/", "/config.local.php", "cache/tmp", "!nada"]);
        assert!(r.is_ignored("logs/error.log", false));
        assert!(r.is_ignored("dist", true));
        assert!(!r.is_ignored("dist", false));
        assert!(r.is_ignored("config.local.php", false));
        assert!(!r.is_ignored("sub/config.local.php", false));
        assert!(r.is_ignored("cache/tmp", true));
        assert!(!r.is_ignored("otra/cache/tmp", true));
        assert!(!r.is_ignored("nada", false));
    }

    #[test]
    fn ignore_file_lines() {
        let lines = parse_ignore_file("*.log\n\n# x\nvendor/\n");
        let r = IgnoreRules::new(&lines);
        assert!(r.is_ignored("a.log", false));
        assert!(r.is_ignored("vendor", true));
    }
}
