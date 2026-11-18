//! Choques entre los alias que exporta SSHorus y los `Host`/`Match` escritos a mano.

use std::collections::HashSet;

use serde::Serialize;

use super::alias::{assign_aliases_with, load_overrides, sanitize_alias};
use super::parse::{cond_matches, is_concrete, tildeify, wildmatch, Cond};
use super::scan::{scan_user_sections, UserKind, UserSection};
use super::SshEnv;
use crate::error::AppResult;
use crate::types::ServerProfile;

/// Un `Host`/`Match` del usuario que captura un alias de SSHorus.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshHostMatch {
    /// Archivo (con `~/` si está en la carpeta personal).
    pub file: String,
    pub line: usize,
    /// La línea tal cual (`Host web *.lan`).
    pub text: String,
    /// El patrón que coincide.
    pub pattern: String,
    /// "exact" (mismo nombre), "pattern" (comodín) o "match" (bloque `Match`).
    pub kind: String,
    /// `Match` con más condiciones: puede que no aplique siempre.
    pub conditional: bool,
    /// Está antes del bloque de SSHorus: ssh usará los valores de esa sección y no los de SSHorus.
    pub before_sshorus: bool,
}

/// Servidor de SSHorus cuyo alias choca con la configuración escrita a mano.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAliasConflict {
    pub server_id: String,
    pub server_name: String,
    pub alias: String,
    /// Alias libre propuesto (`<alias>-tv`).
    pub suggestion: String,
    /// El alias lo eligió el usuario (no es el automático).
    pub custom: bool,
    pub matches: Vec<SshHostMatch>,
}

/// Alias con el que se exportaría un servidor (p. ej. el que se está editando) y sus choques.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAliasInfo {
    pub alias: String,
    /// Alias libre propuesto si hay choques.
    pub suggestion: Option<String>,
    pub matches: Vec<SshHostMatch>,
}

/// Patrón que solo tiene `*` (p. ej. `Host *`): es la configuración común a todos, no un choque.
fn is_catch_all(p: &str) -> bool {
    !p.is_empty() && p.chars().all(|c| c == '*')
}

/// Primer patrón positivo que captura `name` dentro de una lista estilo OpenSSH
/// (un negado que coincide descarta la lista entera). Ignora los `*` sueltos.
fn matching_pattern(pats: &[String], name: &str) -> Option<String> {
    if !cond_matches(&Cond::Hosts(pats.to_vec()), name) {
        return None;
    }
    let lower = name.to_lowercase();
    pats.iter()
        .filter(|p| !p.starts_with('!') && !is_catch_all(p))
        .find(|p| wildmatch(&p.to_lowercase(), &lower))
        .cloned()
}

/// Secciones del usuario que capturan `alias` (cuyo `HostName` es `hostname`).
fn find_matches(env: &SshEnv, sections: &[UserSection], alias: &str, hostname: &str) -> Vec<SshHostMatch> {
    let mut out = Vec::new();
    for s in sections {
        let (pattern, kind, conditional) = match &s.kind {
            UserKind::Host(pats) => match matching_pattern(pats, alias) {
                Some(p) => {
                    let kind = if is_concrete(&p) { "exact" } else { "pattern" };
                    (p, kind, false)
                }
                None => continue,
            },
            UserKind::Match { original, host, conditional } => {
                // `host` se compara con el nombre final (tras HostName); `originalhost`, con el alias.
                let hit = matching_pattern(original, alias)
                    .or_else(|| matching_pattern(host, hostname))
                    .or_else(|| matching_pattern(host, alias));
                match hit {
                    Some(p) => (p, "match", *conditional),
                    None => continue,
                }
            }
        };
        out.push(SshHostMatch {
            file: tildeify(env, &s.file),
            line: s.line,
            text: s.text.clone(),
            pattern,
            kind: kind.into(),
            conditional,
            before_sshorus: s.before_block,
        });
    }
    out
}

/// Primer alias libre entre `<alias>-tv`, `<alias>-tv2`… y `tv-<alias>`, `tv-<alias>-2`… (este último
/// por si el choque es un prefijo como `Host web*`). Libre = no lo captura ningún `Host`/`Match` por
/// nombre y no lo usa otro servidor. Si no hay ninguno, `<alias>-tv`.
fn suggest_alias(env: &SshEnv, sections: &[UserSection], alias: &str, used: &HashSet<String>) -> String {
    let first = format!("{alias}-tv");
    let candidates = std::iter::once(first.clone())
        .chain((2..10).map(|n| format!("{alias}-tv{n}")))
        .chain(std::iter::once(format!("tv-{alias}")))
        .chain((2..10).map(|n| format!("tv-{alias}-{n}")));
    for cand in candidates {
        // Sin HostName: un `Match host <ip>` no se arregla cambiando el alias.
        if !used.contains(&cand) && find_matches(env, sections, &cand, "").is_empty() {
            return cand;
        }
    }
    first
}

/// Servidores de SSHorus cuyo alias exportado choca con un `Host`/`Match` escrito a mano.
pub fn conflicts(env: &SshEnv, servers: &[ServerProfile]) -> AppResult<Vec<SshAliasConflict>> {
    let overrides = load_overrides(env);
    let aliases = assign_aliases_with(servers, &overrides);
    let sections = scan_user_sections(env)?;
    let mut used: HashSet<String> = aliases.iter().cloned().collect();
    let mut out = Vec::new();
    for (srv, alias) in servers.iter().zip(&aliases) {
        let matches = find_matches(env, &sections, alias, &srv.host);
        if matches.is_empty() {
            continue;
        }
        let suggestion = suggest_alias(env, &sections, alias, &used);
        used.insert(suggestion.clone());
        out.push(SshAliasConflict {
            server_id: srv.id.clone(),
            server_name: srv.name.clone(),
            alias: alias.clone(),
            suggestion,
            custom: overrides.get(&srv.id).is_some_and(|a| sanitize_alias(a).ok().as_ref() == Some(alias)),
            matches,
        });
    }
    Ok(out)
}

/// Alias con el que se exportaría `draft` (nuevo si su id está vacío o no existe) y sus choques.
/// `custom`: alias escrito en el editor (None o vacío = automático).
pub fn alias_info(
    env: &SshEnv,
    servers: &[ServerProfile],
    draft: ServerProfile,
    custom: Option<&str>,
) -> AppResult<SshAliasInfo> {
    let custom = custom.map(str::trim).filter(|c| !c.is_empty()).map(sanitize_alias).transpose()?;
    let mut overrides = load_overrides(env);
    let mut list = servers.to_vec();
    let idx = match list.iter().position(|s| !draft.id.is_empty() && s.id == draft.id) {
        Some(i) => i,
        None => {
            list.push(draft.clone());
            list.len() - 1
        }
    };
    list[idx] = draft.clone();
    match custom {
        Some(c) => overrides.insert(draft.id.clone(), c),
        None => overrides.remove(&draft.id),
    };
    let aliases = assign_aliases_with(&list, &overrides);
    let alias = aliases[idx].clone();
    let sections = scan_user_sections(env)?;
    let matches = find_matches(env, &sections, &alias, &draft.host);
    let suggestion = if matches.is_empty() {
        None
    } else {
        let used: HashSet<String> = aliases.into_iter().collect();
        Some(suggest_alias(env, &sections, &alias, &used))
    };
    Ok(SshAliasInfo { alias, suggestion, matches })
}
