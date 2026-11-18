//! Recorre `~/.ssh/config` (y sus `Include`) buscando los `Host`/`Match` escritos a mano.

use std::fs;
use std::path::{Path, PathBuf};

use super::parse::{expand_include, split_line};
use super::{SshEnv, BEGIN_MARKER, END_MARKER, MAX_INCLUDE_DEPTH};
use crate::error::{AppError, AppResult};

/// Sección `Host`/`Match` escrita por el usuario (fuera del bloque de SSHorus o en un `Include`).
#[derive(Debug, Clone)]
pub(super) struct UserSection {
    pub(super) file: PathBuf,
    /// 1 = primera línea.
    pub(super) line: usize,
    pub(super) text: String,
    pub(super) kind: UserKind,
    /// Está antes del bloque de SSHorus: para esos alias ssh usa SUS valores, no los de SSHorus.
    pub(super) before_block: bool,
}

#[derive(Debug, Clone)]
pub(super) enum UserKind {
    Host(Vec<String>),
    /// `Match` con criterios `originalhost` (alias) y/o `host` (alias o HostName).
    Match {
        original: Vec<String>,
        host: Vec<String>,
        /// Tiene otros criterios (`user`, `exec`…) que no evaluamos: «podría» aplicar.
        conditional: bool,
    },
}

struct Scanner<'a> {
    env: &'a SshEnv,
    out: Vec<UserSection>,
}

impl Scanner<'_> {
    /// `before`: None en el archivo principal (se calcula por línea); Some(x) en un `Include`.
    fn scan_text(&mut self, file: &Path, text: &str, depth: usize, before: Option<bool>) {
        let lines: Vec<&str> = text.lines().collect();
        // Dónde está (o se insertaría) el bloque de SSHorus en el archivo principal.
        let anchor = if before.is_none() {
            lines.iter().position(|l| l.trim() == BEGIN_MARKER).or_else(|| {
                lines
                    .iter()
                    .position(|l| matches!(split_line(l).map(|(k, _)| k).as_deref(), Some("host" | "match")))
            })
        } else {
            None
        };
        let mut in_sshorus = false;
        for (i, raw) in lines.iter().enumerate() {
            let trimmed = raw.trim();
            if trimmed == BEGIN_MARKER {
                in_sshorus = true;
                continue;
            }
            if trimmed == END_MARKER {
                in_sshorus = false;
                continue;
            }
            if in_sshorus {
                continue;
            }
            let Some((key, args)) = split_line(trimmed) else { continue };
            let is_before = before.unwrap_or_else(|| anchor.is_none_or(|a| i < a));
            let kind = match key.as_str() {
                "host" => UserKind::Host(args),
                "match" => match parse_match(&args) {
                    Some(k) => k,
                    None => continue,
                },
                "include" => {
                    if depth < MAX_INCLUDE_DEPTH {
                        for a in &args {
                            for p in expand_include(self.env, a) {
                                match fs::read(&p) {
                                    Ok(b) => self.scan_text(&p, &String::from_utf8_lossy(&b), depth + 1, Some(is_before)),
                                    Err(e) => log::warn!("No se pudo leer {}: {e}", p.display()),
                                }
                            }
                        }
                    }
                    continue;
                }
                _ => continue,
            };
            self.out.push(UserSection {
                file: file.to_path_buf(),
                line: i + 1,
                text: trimmed.to_string(),
                kind,
                before_block: is_before,
            });
        }
    }
}

/// Criterios de `Match` que afectan a un alias. None si no puede capturar uno concreto
/// (`Match all`, solo `user`/`exec`…).
fn parse_match(args: &[String]) -> Option<UserKind> {
    let (mut original, mut host, mut conditional) = (Vec::new(), Vec::new(), false);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let crit = a.to_ascii_lowercase();
        match crit.as_str() {
            "all" | "canonical" | "final" => {}
            "host" | "originalhost" => {
                let Some(v) = it.next() else { break };
                let pats = v.split(',').filter(|p| !p.is_empty()).map(str::to_string);
                if crit == "host" {
                    host.extend(pats);
                } else {
                    original.extend(pats);
                }
            }
            _ => {
                // `user x`, `exec "…"`, `!host x`… : no se evalúan.
                conditional = true;
                if !matches!(crit.trim_start_matches('!'), "all" | "canonical" | "final") {
                    it.next();
                }
            }
        }
    }
    if original.is_empty() && host.is_empty() {
        return None;
    }
    Some(UserKind::Match { original, host, conditional })
}

/// Lee `~/.ssh/config` (y sus `Include`) y devuelve los `Host`/`Match` escritos a mano.
pub(super) fn scan_user_sections(env: &SshEnv) -> AppResult<Vec<UserSection>> {
    let bytes = match fs::read(&env.config) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(AppError::Io(format!("no se pudo leer {}: {e}", env.config.display()))),
    };
    let mut sc = Scanner { env, out: Vec::new() };
    sc.scan_text(&env.config, &String::from_utf8_lossy(&bytes), 0, None);
    Ok(sc.out)
}
