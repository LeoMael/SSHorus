//! Mover secretos entre el llavero y la bóveda (al crearla y al quitarla), sin perder nunca ninguno.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use super::super::cipher::KdfParams;
use super::super::vault::{PinKind, Vault};
use super::system_keyring::UNAVAILABLE;
use super::{server_secret_ids, Keyring, GITHUB_TOKEN_USER, MCP_TOKEN_USER};
use crate::error::{AppError, AppResult};

/// Resultado de mover secretos.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveReport {
    /// Secretos movidos.
    pub moved: u32,
    /// Al activar: copias que no se pudieron borrar del llavero (siguen allí, no se perdió nada).
    pub left_in_keyring: u32,
}

/// El llavero no existe en este sistema (no hay nada que leer).
fn keyring_unavailable(e: &AppError) -> bool {
    matches!(e, AppError::Keyring(m) if m == UNAVAILABLE)
}

/// Crea la bóveda y mueve a ella los secretos del llavero de esos servidores (contraseña de
/// conexión y de sudo), el token de GitHub, el del servidor MCP (`mcp-token`) y el de la IA que
/// explica informes (`ai-token`).
///
/// Orden seguro: 1) leer todo del llavero (si algo falla, no se crea nada); 2) escribir la
/// bóveda y comprobar que se descifra; 3) solo entonces borrar las copias del llavero. Si se corta
/// a mitad, los secretos siguen en el llavero, en la bóveda o en ambos: nunca se pierden.
pub(crate) fn enable_vault(
    vault: &Vault,
    kr: &dyn Keyring,
    ids: &[String],
    pin: &str,
    kind: PinKind,
    params: KdfParams,
) -> AppResult<MoveReport> {
    super::super::vault::check_new_secret(pin, kind)?;
    let users: BTreeSet<String> = ids
        .iter()
        .map(String::as_str)
        .filter(|u| !u.trim().is_empty())
        .flat_map(server_secret_ids)
        .chain([
            GITHUB_TOKEN_USER.to_string(),
            MCP_TOKEN_USER.to_string(),
            crate::ai::AI_TOKEN_USER.to_string(),
        ])
        .collect();
    let mut found = BTreeMap::new();
    for u in users {
        match kr.get(&u) {
            Ok(Some(s)) if !s.is_empty() => {
                found.insert(u, s);
            }
            Ok(_) => {}
            // Sin llavero en el sistema no puede haber nada guardado en él.
            Err(e) if keyring_unavailable(&e) => break,
            Err(e) => return Err(e),
        }
    }
    let ids: Vec<String> = found.keys().cloned().collect();
    vault.create(pin, kind, found, params)?;
    let mut report = MoveReport {
        moved: ids.len() as u32,
        left_in_keyring: 0,
    };
    for id in &ids {
        if let Err(e) = kr.delete(id) {
            log::warn!("bóveda: no se pudo borrar del llavero la copia de {id}: {e}");
            report.left_in_keyring += 1;
        }
    }
    Ok(report)
}

/// Desactiva la bóveda: comprueba el PIN o la contraseña, devuelve los secretos al llavero, comprueba que están y
/// solo entonces borra `vault.json`. Si algo falla, la bóveda sigue igual.
pub(crate) fn disable_vault(vault: &Vault, kr: &dyn Keyring, pin: &str) -> AppResult<MoveReport> {
    let secrets = vault.export_with_pin(pin)?;
    let mut written: Vec<&str> = Vec::new();
    let undo = |written: &[&str]| {
        for id in written {
            let _ = kr.delete(id);
        }
    };
    for (id, s) in &secrets {
        if let Err(e) = kr.set(id, s) {
            undo(&written);
            return Err(e);
        }
        written.push(id);
    }
    for (id, s) in &secrets {
        let ok = matches!(kr.get(id), Ok(Some(v)) if v == **s);
        if !ok {
            undo(&written);
            return Err(AppError::Keyring(
                "no se pudo comprobar que las contraseñas quedaron en el llavero; la bóveda sigue activa"
                    .into(),
            ));
        }
    }
    vault.remove()?;
    Ok(MoveReport {
        moved: secrets.len() as u32,
        left_in_keyring: 0,
    })
}
