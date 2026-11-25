//! Leer, guardar y borrar un secreto en el llavero del sistema (crate `keyring`), con los casos raros
//! resueltos: entradas repetidas («Ambiguous»), creadas por otra app o por una versión vieja.
//!
//! No usa nada de la app (`crate::`): lo comparten `storage::secrets` y el puente `sshorus-mcp`, que se
//! compila aparte con `#[path]` y guarda ahí el token de cada asistente emparejado. Los errores se
//! devuelven tal cual: cada uno los traduce a su manera.

use keyring::{Entry, Error};

pub fn get(service: &str, user: &str) -> Result<Option<String>, Error> {
    let e = Entry::new(service, user)?;
    match e.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(Error::NoEntry) => Ok(None),
        // Varias entradas iguales (p. ej. creadas por otra app): vale la primera legible.
        Err(Error::Ambiguous(entries)) => Ok(entries.into_iter().find_map(|c| c.get_password().ok())),
        Err(err) => Err(err),
    }
}

pub fn set(service: &str, user: &str, secret: &str) -> Result<(), Error> {
    let e = Entry::new(service, user)?;
    match e.set_password(secret) {
        Ok(()) => Ok(()),
        Err(Error::Ambiguous(entries)) => {
            // Se limpian los duplicados y se guarda de nuevo.
            for c in entries {
                let _ = c.delete_credential();
            }
            e.set_password(secret)
        }
        Err(err) => Err(err),
    }
}

/// Borrar lo que no existe no es error.
pub fn delete(service: &str, user: &str) -> Result<(), Error> {
    let e = Entry::new(service, user)?;
    match e.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(Error::Ambiguous(entries)) => {
            for c in entries {
                match c.delete_credential() {
                    Ok(()) | Err(Error::NoEntry) => {}
                    Err(err) => return Err(err),
                }
            }
            Ok(())
        }
        Err(err) => Err(err),
    }
}
