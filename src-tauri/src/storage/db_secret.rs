//! Usuario y contraseña de las bases de datos de un servidor («Bases de datos», solo lectura del esquema).
//!
//! Un solo secreto por servidor (`<id>:db`, en la bóveda o el llavero como los demás) con un mapa JSON
//! «destino → credencial». Así se borra y se copia junto con el servidor (`server_secret_ids`) sin tener
//! que recorrer el llavero. El destino es la clave que arma la interfaz (`pg@127.0.0.1:5432`,
//! `mysql@ctr:podman:ana/tienda-db`…). La contraseña solo va a la interfaz, que la pasa por stdin al comando
//! remoto: nunca a la línea de comandos, a los registros ni al asistente de IA.

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::secrets;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbCredential {
    pub user: String,
    pub password: String,
}

type CredMap = BTreeMap<String, DbCredential>;

/// Una escritura a la vez (leer, cambiar y guardar el mapa).
static WRITE: Mutex<()> = Mutex::new(());

const MAX_TARGET_LEN: usize = 300;

fn check_target(target: &str) -> AppResult<()> {
    if target.trim().is_empty() || target.len() > MAX_TARGET_LEN || target.contains(['\n', '\0']) {
        return Err(AppError::Invalid("Destino de base de datos no válido".into()));
    }
    Ok(())
}

/// Mapa guardado (vacío si no hay o si no se entiende).
fn parse_map(raw: Option<&str>) -> CredMap {
    raw.and_then(|s| serde_json::from_str(s).ok()).unwrap_or_default()
}

/// Mapa con `target` cambiado (`None` lo quita). Devuelve el JSON a guardar, o `None` si queda vacío.
fn updated(raw: Option<&str>, target: &str, cred: Option<DbCredential>) -> AppResult<Option<Zeroizing<String>>> {
    let mut map = parse_map(raw);
    match cred {
        Some(c) => {
            map.insert(target.to_string(), c);
        }
        None => {
            map.remove(target);
        }
    }
    if map.is_empty() {
        return Ok(None);
    }
    Ok(Some(Zeroizing::new(serde_json::to_string(&map)?)))
}

fn read(profile_id: &str) -> AppResult<CredMap> {
    let raw = secrets::get_secret(&secrets::db_id(profile_id))?.map(Zeroizing::new);
    Ok(parse_map(raw.as_deref().map(String::as_str)))
}

/// Destinos con credencial guardada (sin contraseñas).
pub fn targets(profile_id: &str) -> AppResult<Vec<String>> {
    Ok(read(profile_id)?.into_keys().collect())
}

/// Credencial guardada de un destino.
pub fn get(profile_id: &str, target: &str) -> AppResult<Option<DbCredential>> {
    check_target(target)?;
    Ok(read(profile_id)?.remove(target))
}

/// Guarda (Some) u olvida (None) la credencial de un destino.
pub fn set(profile_id: &str, target: &str, credential: Option<DbCredential>) -> AppResult<()> {
    check_target(target)?;
    if credential.as_ref().is_some_and(|c| c.user.trim().is_empty()) {
        return Err(AppError::Invalid("Escribe el usuario de la base de datos".into()));
    }
    let _one = WRITE.lock().unwrap_or_else(|p| p.into_inner());
    let id = secrets::db_id(profile_id);
    let raw = secrets::get_secret(&id)?.map(Zeroizing::new);
    match updated(raw.as_deref().map(String::as_str), target, credential)? {
        Some(json) => secrets::set_secret(&id, &json),
        None => secrets::delete_secret(&id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cred(u: &str, p: &str) -> DbCredential {
        DbCredential { user: u.into(), password: p.into() }
    }

    #[test]
    fn map_add_replace_and_remove() {
        let a = updated(None, "pg@127.0.0.1:5432", Some(cred("app", "s3cr\"et"))).unwrap().unwrap();
        let m = parse_map(Some(&a));
        assert_eq!(m.get("pg@127.0.0.1:5432"), Some(&cred("app", "s3cr\"et")));
        let b = updated(Some(&a), "mysql@ctr:ana/db", Some(cred("root", "x"))).unwrap().unwrap();
        assert_eq!(parse_map(Some(&b)).len(), 2);
        let c = updated(Some(&b), "pg@127.0.0.1:5432", Some(cred("otro", "y"))).unwrap().unwrap();
        assert_eq!(parse_map(Some(&c)).get("pg@127.0.0.1:5432").unwrap().user, "otro");
        let d = updated(Some(&c), "pg@127.0.0.1:5432", None).unwrap().unwrap();
        assert_eq!(parse_map(Some(&d)).keys().collect::<Vec<_>>(), ["mysql@ctr:ana/db"]);
        // Sin ninguna: se borra el secreto entero.
        assert!(updated(Some(&d), "mysql@ctr:ana/db", None).unwrap().is_none());
    }

    #[test]
    fn broken_map_starts_empty_and_targets_are_checked() {
        assert!(parse_map(Some("no es json")).is_empty());
        assert!(parse_map(None).is_empty());
        assert!(check_target("").is_err());
        assert!(check_target("a\nb").is_err());
        assert!(check_target(&"x".repeat(MAX_TARGET_LEN + 1)).is_err());
        assert!(check_target("sqlite@/srv/app/data.db").is_ok());
    }

    #[test]
    fn credential_json_is_camel_case() {
        let v = serde_json::to_value(cred("u", "p")).unwrap();
        assert_eq!(v, serde_json::json!({ "user": "u", "password": "p" }));
    }
}
