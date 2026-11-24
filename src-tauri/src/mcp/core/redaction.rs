//! Tapar en las salidas para la IA las contraseñas guardadas del servidor (`redact.rs`): por si un comando
//! o un archivo las muestra. Solo las largas (`MIN_KNOWN_LEN`); las que SSHorus acaba de escribir, siempre.

use zeroize::Zeroizing;

use super::super::backend::{Backend, SavedPassword};
use super::super::redact::{redact_all, MIN_KNOWN_LEN};
use super::{McpCore, Target};

impl<B: Backend> McpCore<B> {
    /// Tapa en `text` las contraseñas de `extra` y las guardadas del servidor (conexión y sudo).
    pub(super) async fn redact_known(&self, t: &Target, sid: &str, text: &mut String, extra: &[Zeroizing<String>]) {
        let mut known: Vec<Zeroizing<String>> = Vec::new();
        for kind in [SavedPassword::Login, SavedPassword::Sudo] {
            if let Ok(Some(s)) = self.backend.saved_password(&t.server.id, sid, kind).await
                && s.chars().count() >= MIN_KNOWN_LEN
            {
                known.push(s);
            }
        }
        let all: Vec<&str> = extra.iter().chain(known.iter()).map(|s| s.as_str()).collect();
        redact_all(text, &all, false);
    }
}
