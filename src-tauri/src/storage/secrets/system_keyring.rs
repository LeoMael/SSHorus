//! El llavero del sistema: leer, guardar y borrar por servicio (los tests usan "sshorus-test"), la
//! llave de este equipo de la bóveda y errores traducidos a mensajes claros.

use base64ct::{Base64, Encoding};
use keyring::Error as KrError;
use zeroize::Zeroizing;

use super::super::keyring_store;
use super::super::vault::{DeviceKeyStore, DEVICE_KEY_USER};
use super::check_user;
use crate::error::{AppError, AppResult};

/// Dónde se leen y escriben los secretos fuera de la bóveda (el llavero; en tests, memoria).
pub(crate) trait Keyring {
    fn get(&self, user: &str) -> AppResult<Option<String>>;
    fn set(&self, user: &str, secret: &str) -> AppResult<()>;
    fn delete(&self, user: &str) -> AppResult<()>;
}

/// El llavero del sistema con un servicio concreto ("sshorus"; "sshorus-test" en pruebas).
pub(crate) struct SystemKeyring(pub &'static str);

impl Keyring for SystemKeyring {
    fn get(&self, user: &str) -> AppResult<Option<String>> {
        get_secret_in(self.0, user)
    }
    fn set(&self, user: &str, secret: &str) -> AppResult<()> {
        set_secret_in(self.0, user, secret)
    }
    fn delete(&self, user: &str) -> AppResult<()> {
        delete_secret_in(self.0, user)
    }
}

/// La llave de este equipo de la bóveda, en el llavero del sistema (usuario `vault-device-key`,
/// en base64). Va siempre al llavero, nunca a la bóveda.
pub(crate) struct KeyringDeviceKey(pub &'static str);

impl DeviceKeyStore for KeyringDeviceKey {
    fn load(&self) -> AppResult<Option<Zeroizing<Vec<u8>>>> {
        let Some(text) = get_secret_in(self.0, DEVICE_KEY_USER)?.map(Zeroizing::new) else {
            return Ok(None);
        };
        Base64::decode_vec(text.trim())
            .map(|k| Some(Zeroizing::new(k)))
            .map_err(|_| AppError::Invalid("la llave de este equipo en el llavero está dañada".into()))
    }
    fn save(&self, key: &[u8]) -> AppResult<()> {
        let text = Zeroizing::new(Base64::encode_string(key));
        set_secret_in(self.0, DEVICE_KEY_USER, &text)
    }
    fn delete(&self) -> AppResult<()> {
        delete_secret_in(self.0, DEVICE_KEY_USER)
    }
}

pub(crate) fn get_secret_in(service: &str, user: &str) -> AppResult<Option<String>> {
    check_user(user)?;
    keyring_store::get(service, user).map_err(map_err)
}

pub(crate) fn set_secret_in(service: &str, user: &str, secret: &str) -> AppResult<()> {
    check_user(user)?;
    keyring_store::set(service, user, secret).map_err(map_err)
}

pub(crate) fn delete_secret_in(service: &str, user: &str) -> AppResult<()> {
    check_user(user)?;
    keyring_store::delete(service, user).map_err(map_err)
}

#[cfg(not(any(windows, target_os = "macos")))]
pub(super) const UNAVAILABLE: &str = "no hay un llavero del sistema disponible. Instala o activa GNOME Keyring, \
KWallet u otro servicio compatible con Secret Service (o no marques «guardar en el llavero»).";
#[cfg(windows)]
pub(super) const UNAVAILABLE: &str = "el Administrador de credenciales de Windows no está disponible \
(o no marques «guardar en el llavero»).";
#[cfg(target_os = "macos")]
pub(super) const UNAVAILABLE: &str = "el llavero de macOS no está disponible (o no marques «guardar en el llavero»).";

fn map_err(err: KrError) -> AppError {
    let msg = match err {
        KrError::NoDefaultStore => UNAVAILABLE.to_string(),
        KrError::NoStorageAccess(e) => {
            format!("el llavero está bloqueado o se negó el acceso ({e}). Desbloquéalo e inténtalo de nuevo.")
        }
        KrError::PlatformFailure(e) => {
            let detail = e.to_string();
            if looks_unavailable(&detail) {
                UNAVAILABLE.to_string()
            } else {
                format!("error del llavero: {detail}")
            }
        }
        KrError::BadEncoding(_) => "el secreto guardado no es texto válido".to_string(),
        KrError::TooLong(attr, max) => format!("«{attr}» es demasiado largo (máx. {max})"),
        KrError::Invalid(attr, why) => format!("dato inválido «{attr}»: {why}"),
        other => other.to_string(),
    };
    AppError::Keyring(msg)
}

fn looks_unavailable(detail: &str) -> bool {
    let d = detail.to_ascii_lowercase();
    d.contains("serviceunknown")
        || d.contains("not provided by any .service")
        || d.contains("dbus_session_bus_address")
        || d.contains("no such file or directory")
        || d.contains("connection refused")
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SERVICE: &str = "sshorus-test";

    /// Usa el llavero real del sistema con el servicio "sshorus-test".
    /// `cargo test --lib storage -- --ignored --test-threads=1`
    #[test]
    #[ignore]
    fn keyring_roundtrip() {
        let user = format!("test-{}", uuid::Uuid::new_v4());
        match get_secret_in(TEST_SERVICE, &user) {
            Ok(None) => {}
            Ok(Some(_)) => panic!("no debería existir"),
            Err(AppError::Keyring(m)) => {
                eprintln!("Llavero no disponible, se omite: {m}");
                return;
            }
            Err(e) => panic!("{e}"),
        }
        set_secret_in(TEST_SERVICE, &user, "s3cr3t ñ").unwrap();
        assert_eq!(get_secret_in(TEST_SERVICE, &user).unwrap().as_deref(), Some("s3cr3t ñ"));
        set_secret_in(TEST_SERVICE, &user, "otra").unwrap();
        assert_eq!(get_secret_in(TEST_SERVICE, &user).unwrap().as_deref(), Some("otra"));
        delete_secret_in(TEST_SERVICE, &user).unwrap();
        assert_eq!(get_secret_in(TEST_SERVICE, &user).unwrap(), None);
        // Borrar dos veces no es error.
        delete_secret_in(TEST_SERVICE, &user).unwrap();
    }

    #[test]
    fn empty_user_is_invalid() {
        assert!(matches!(get_secret_in(TEST_SERVICE, " "), Err(AppError::Invalid(_))));
    }
}
