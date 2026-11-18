//! Alias de `Host` para cada servidor: automáticos (a partir del nombre) o elegidos a mano.

use std::collections::{BTreeMap, HashSet};
use std::sync::Mutex;

use super::{fsutil, SshEnv};
use crate::error::{AppError, AppResult};
use crate::types::ServerProfile;

/// Alias seguro para cada servidor (mismo orden), sin duplicados: `web`, `web-2`, `web-3`…
#[cfg(test)]
pub fn assign_aliases(servers: &[ServerProfile]) -> Vec<String> {
    assign_aliases_with(servers, &AliasOverrides::new())
}

/// Como [`assign_aliases`], pero respetando los alias elegidos a mano (`overrides`, id → alias).
/// Los elegidos a mano se reservan primero, así un alias automático nunca se los quita.
pub fn assign_aliases_with(servers: &[ServerProfile], overrides: &AliasOverrides) -> Vec<String> {
    let mut used = HashSet::new();
    let mut out = vec![String::new(); servers.len()];
    let mut pending = Vec::new();
    for (i, s) in servers.iter().enumerate() {
        match overrides.get(&s.id).and_then(|a| sanitize_alias(a).ok()) {
            Some(a) if used.insert(a.clone()) => out[i] = a,
            other => pending.push((i, other.unwrap_or_else(|| slugify(&s.name)))),
        }
    }
    for (i, base) in pending {
        let mut alias = base.clone();
        let mut n = 2;
        while used.contains(&alias) {
            alias = format!("{base}-{n}");
            n += 1;
        }
        used.insert(alias.clone());
        out[i] = alias;
    }
    out
}

/// Alias escrito a mano → forma segura para `Host`: minúsculas, `[a-z0-9._-]`, sin comodines.
pub fn sanitize_alias(input: &str) -> AppResult<String> {
    let a = input.trim().to_lowercase();
    if a.is_empty() {
        return Err(AppError::Invalid("El alias no puede estar vacío".into()));
    }
    if a.chars().count() > 64 {
        return Err(AppError::Invalid("El alias es demasiado largo (máximo 64 caracteres)".into()));
    }
    if !a.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        return Err(AppError::Invalid(
            "El alias solo puede tener letras sin acentos, números, «-», «_» y «.»".into(),
        ));
    }
    if a.starts_with(['-', '.']) {
        return Err(AppError::Invalid("El alias no puede empezar por «-» ni por «.»".into()));
    }
    Ok(a)
}

/// `Cliente X / web` → `cliente-x-web`. Solo `[a-z0-9-]`; vacío → `servidor`.
pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in name.chars().flat_map(char::to_lowercase).map(fold_accent) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "servidor".into()
    } else {
        out
    }
}

fn fold_accent(c: char) -> char {
    match c {
        'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' => 'a',
        'é' | 'è' | 'ë' | 'ê' => 'e',
        'í' | 'ì' | 'ï' | 'î' => 'i',
        'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
        'ú' | 'ù' | 'ü' | 'û' => 'u',
        'ñ' => 'n',
        'ç' => 'c',
        'ý' | 'ÿ' => 'y',
        _ => c,
    }
}

// ───────────────────────── Alias elegidos a mano ─────────────────────────

/// id del servidor → alias que el usuario eligió para `~/.ssh/config`.
pub type AliasOverrides = BTreeMap<String, String>;

static ALIASES_LOCK: Mutex<()> = Mutex::new(());

pub fn load_overrides(env: &SshEnv) -> AliasOverrides {
    match &env.aliases_file {
        Some(p) => fsutil::read_json_or_default(p),
        None => AliasOverrides::new(),
    }
}

/// Aplica cambios (`None` o vacío = volver al alias automático) y quita los de servidores que ya
/// no existen. Devuelve el mapa resultante. Falla (sin guardar nada) si algún alias no es válido.
pub fn update_overrides(
    env: &SshEnv,
    changes: &BTreeMap<String, Option<String>>,
    valid_ids: &HashSet<String>,
) -> AppResult<AliasOverrides> {
    let _guard = ALIASES_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut map = load_overrides(env);
    for (id, alias) in changes {
        match alias.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
            Some(a) => {
                map.insert(id.clone(), sanitize_alias(a)?);
            }
            None => {
                map.remove(id);
            }
        }
    }
    map.retain(|id, _| valid_ids.contains(id));
    if let Some(p) = &env.aliases_file {
        fsutil::write_json_atomic(p, &map)?;
    }
    Ok(map)
}
