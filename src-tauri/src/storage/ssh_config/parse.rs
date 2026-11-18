//! Lectura de `~/.ssh/config` al estilo de OpenSSH: líneas, secciones `Host`/`Match`, `Include`,
//! comodines y tokens.

use std::fs;
use std::path::{Component, Path, PathBuf};

use super::{SshEnv, BEGIN_MARKER, END_MARKER, MAX_INCLUDE_DEPTH};

/// Divide una línea en (palabra clave en minúsculas, argumentos). None si es vacía o comentario.
/// Admite `Clave valor`, `Clave=valor` y argumentos entre comillas dobles.
pub fn split_line(line: &str) -> Option<(String, Vec<String>)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let end = line.find(|c: char| c.is_whitespace() || c == '=').unwrap_or(line.len());
    let key = line[..end].to_ascii_lowercase();
    if key.is_empty() {
        return None;
    }
    let mut rest = line[end..].trim_start();
    if let Some(r) = rest.strip_prefix('=') {
        rest = r.trim_start();
    }
    let mut args = Vec::new();
    let mut cur = String::new();
    let mut in_arg = false;
    let mut quoted = false;
    for c in rest.chars() {
        if quoted {
            if c == '"' {
                quoted = false;
            } else {
                cur.push(c);
            }
        } else if c == '"' {
            quoted = true;
            in_arg = true;
        } else if c.is_whitespace() {
            if in_arg {
                args.push(std::mem::take(&mut cur));
                in_arg = false;
            }
        } else if c == '#' && !in_arg {
            break; // comentario al final de la línea
        } else {
            cur.push(c);
            in_arg = true;
        }
    }
    if in_arg {
        args.push(cur);
    }
    Some((key, args))
}

#[derive(Debug, Clone)]
pub(super) enum Cond {
    /// Opciones globales o `Match all`.
    All,
    /// `Host patrón…`
    Hosts(Vec<String>),
    /// `Match …` (no lo evaluamos: se ignora).
    Never,
}

#[derive(Debug)]
pub(super) struct Section {
    pub(super) cond: Cond,
    pub(super) opts: Vec<(String, Vec<String>)>,
}

pub(super) struct Parser<'a> {
    pub(super) env: &'a SshEnv,
    pub(super) sections: Vec<Section>,
    pub(super) aliases: Vec<String>,
}

impl Parser<'_> {
    fn parse_file(&mut self, path: &Path, depth: usize, cond: Cond) {
        match fs::read(path) {
            Ok(b) => self.parse_text(&String::from_utf8_lossy(&b), depth, cond),
            Err(e) => log::warn!("No se pudo leer {}: {e}", path.display()),
        }
    }

    pub(super) fn parse_text(&mut self, text: &str, depth: usize, cond: Cond) {
        self.sections.push(Section { cond: cond.clone(), opts: Vec::new() });
        let mut cur = cond;
        let mut in_sshorus = false;
        for raw in text.lines() {
            let trimmed = raw.trim();
            if trimmed == BEGIN_MARKER {
                in_sshorus = true;
                continue;
            }
            if trimmed == END_MARKER {
                in_sshorus = false;
                continue;
            }
            let Some((key, args)) = split_line(trimmed) else { continue };
            match key.as_str() {
                "host" => {
                    cur = Cond::Hosts(args.clone());
                    self.sections.push(Section { cond: cur.clone(), opts: Vec::new() });
                    if !in_sshorus {
                        for a in args {
                            if is_concrete(&a) && !self.aliases.contains(&a) {
                                self.aliases.push(a);
                            }
                        }
                    }
                }
                "match" => {
                    let all = args.len() == 1 && args[0].eq_ignore_ascii_case("all");
                    cur = if all { Cond::All } else { Cond::Never };
                    self.sections.push(Section { cond: cur.clone(), opts: Vec::new() });
                }
                "include" => {
                    if in_sshorus || depth >= MAX_INCLUDE_DEPTH {
                        continue;
                    }
                    for a in &args {
                        for p in expand_include(self.env, a) {
                            self.parse_file(&p, depth + 1, cur.clone());
                        }
                    }
                    // Tras el Include sigue el contexto del archivo actual.
                    self.sections.push(Section { cond: cur.clone(), opts: Vec::new() });
                }
                _ if in_sshorus => {}
                _ => {
                    if let Some(s) = self.sections.last_mut() {
                        s.opts.push((key, args));
                    }
                }
            }
        }
    }
}

pub(super) fn is_concrete(pattern: &str) -> bool {
    !pattern.is_empty() && !pattern.contains(['*', '?', '!'])
}

/// Igual que `match_pattern_list` de OpenSSH: un negado que coincide descarta.
pub(super) fn cond_matches(cond: &Cond, alias: &str) -> bool {
    match cond {
        Cond::All => true,
        Cond::Never => false,
        Cond::Hosts(pats) => {
            let alias = alias.to_lowercase();
            let mut found = false;
            for p in pats {
                let (neg, p) = match p.strip_prefix('!') {
                    Some(r) => (true, r),
                    None => (false, p.as_str()),
                };
                if wildmatch(&p.to_lowercase(), &alias) {
                    if neg {
                        return false;
                    }
                    found = true;
                }
            }
            found
        }
    }
}

/// Comodines `*` y `?`.
pub(super) fn wildmatch(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some((pi, ti));
            pi += 1;
        } else if let Some((sp, st)) = star {
            pi = sp + 1;
            ti = st + 1;
            star = Some((sp, st + 1));
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

pub(super) fn expand_tilde(env: &SshEnv, p: &str) -> PathBuf {
    if p == "~" {
        env.home.clone()
    } else if let Some(r) = p.strip_prefix("~/") {
        env.home.join(r)
    } else if let Some(r) = p.strip_prefix("~\\").filter(|_| cfg!(windows)) {
        env.home.join(r)
    } else {
        PathBuf::from(p)
    }
}

/// Rutas de un `Include`: `~` → home, relativas → ~/.ssh, con comodines (ordenadas, como glob()).
pub(super) fn expand_include(env: &SshEnv, arg: &str) -> Vec<PathBuf> {
    let p = expand_tilde(env, arg);
    let p = if p.is_absolute() { p } else { env.ssh_dir.join(p) };
    glob(&p)
}

fn glob(pattern: &Path) -> Vec<PathBuf> {
    let mut acc = vec![PathBuf::new()];
    for comp in pattern.components() {
        let part = comp.as_os_str().to_string_lossy();
        let is_glob = matches!(comp, Component::Normal(_)) && part.contains(['*', '?']);
        let mut next = Vec::new();
        for base in &acc {
            if is_glob {
                let Ok(rd) = fs::read_dir(base) else { continue };
                let mut names: Vec<String> = rd
                    .flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .filter(|n| (!n.starts_with('.') || part.starts_with('.')) && wildmatch(&part, n))
                    .collect();
                names.sort();
                next.extend(names.into_iter().map(|n| base.join(n)));
            } else {
                next.push(base.join(comp.as_os_str()));
            }
        }
        acc = next;
    }
    acc.retain(|p| p.is_file());
    acc
}

/// `~/…` con `/` como separador (también en Windows, donde OpenSSH lo acepta).
pub(super) fn tildeify(env: &SshEnv, p: &Path) -> String {
    match p.strip_prefix(&env.home) {
        Ok(rest) => {
            let parts: Vec<String> = rest.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
            format!("~/{}", parts.join("/"))
        }
        Err(_) => p.display().to_string(),
    }
}

/// Expande los tokens más comunes de OpenSSH.
pub(super) fn expand_tokens(env: &SshEnv, v: &str, alias: &str) -> String {
    let mut out = String::new();
    let mut it = v.chars();
    while let Some(c) = it.next() {
        if c != '%' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('%') => out.push('%'),
            Some('h') | Some('n') => out.push_str(alias),
            Some('u') => out.push_str(&env.local_user),
            Some('d') => out.push('~'),
            Some(o) => {
                out.push('%');
                out.push(o);
            }
            None => out.push('%'),
        }
    }
    out
}
