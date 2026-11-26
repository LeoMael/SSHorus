//! Contraseña de sudo de un servidor: cuál toca según su ajuste y, para escribirla en la terminal,
//! con el PIN o la contraseña de SSHorus comprobados antes. Nunca va a disco ni a logs.

use zeroize::Zeroizing;

use super::secrets::{self, SecretKind};
use super::{blocking, vault, ProfileStore};
use crate::error::{AppError, AppResult};
use crate::ssh::SessionStore;
use crate::types::{AuthMethod, SudoMode};

/// De dónde sale la contraseña de sudo de un servidor.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum SudoSource {
    /// «Pedir cada vez», o «La de la conexión» sin contraseña (entra con llave).
    None,
    /// «La de la conexión»: la que se escribió al conectar o, si no, la guardada.
    Login,
    /// Guardada aparte.
    Saved,
}

pub(super) fn sudo_source(auth: AuthMethod, mode: SudoMode) -> SudoSource {
    match mode {
        SudoMode::Ask => SudoSource::None,
        SudoMode::Login if auth == AuthMethod::Password => SudoSource::Login,
        SudoMode::Login => SudoSource::None,
        SudoMode::Saved => SudoSource::Saved,
    }
}

/// Contraseña de sudo según el ajuste del servidor. Con «La de la conexión» y `session_id`, primero la
/// que se escribió al conectar esa sesión (aunque no se guardara; ver `ssh::login_secret`).
pub(super) async fn resolve(
    store: &ProfileStore,
    sessions: &SessionStore,
    id: &str,
    session_id: Option<&str>,
) -> AppResult<Option<String>> {
    let server = store.get_server(id)?;
    let secret_id = match sudo_source(server.auth, server.sudo_mode) {
        SudoSource::None => return Ok(None),
        SudoSource::Login => {
            if let Some(sid) = session_id {
                // Solo si la sesión sigue abierta y es de este servidor.
                let same = sessions.get(sid).await.is_ok_and(|s| s.info.profile_id == id);
                if let Some(p) = same.then(|| crate::ssh::login_secret::get(sid)).flatten() {
                    return Ok(Some(p.to_string()));
                }
            }
            SecretKind::Login.id(id)
        }
        SudoSource::Saved => SecretKind::Sudo.id(id),
    };
    blocking(move || secrets::get_secret(&secret_id)).await
}

/// Para escribirla en la terminal: exige que SSHorus tenga PIN o contraseña y lo comprueba antes
/// (cuenta como intento, con la misma espera tras fallos que al desbloquear). None = no hay guardada.
pub(super) async fn reveal(
    store: &ProfileStore,
    sessions: &SessionStore,
    id: &str,
    session_id: Option<&str>,
    pin: String,
) -> AppResult<Option<String>> {
    let pin = Zeroizing::new(pin);
    blocking(move || {
        let v = vault::Vault::global();
        if !v.is_enabled() {
            return Err(AppError::Invalid(
                "Configura un PIN o contraseña en Ajustes → Seguridad para usar esto".into(),
            ));
        }
        v.check_pin(&pin)
    })
    .await?;
    resolve(store, sessions, id, session_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fuente_segun_el_ajuste() {
        assert_eq!(sudo_source(AuthMethod::Password, SudoMode::Ask), SudoSource::None);
        assert_eq!(sudo_source(AuthMethod::Password, SudoMode::Login), SudoSource::Login);
        assert_eq!(sudo_source(AuthMethod::Key, SudoMode::Login), SudoSource::None);
        assert_eq!(sudo_source(AuthMethod::Key, SudoMode::Saved), SudoSource::Saved);
    }
}
