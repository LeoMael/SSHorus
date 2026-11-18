//! Utilidades SOLO para tests (usadas también por los tests de terminal, sftp y transfer).

use std::sync::Arc;

use crate::ssh::handler::HostKeyPolicy;
use crate::ssh::SshSession;
use crate::types::{AuthMethod, ServerProfile};

use super::Credentials;

pub const TEST_HOST: &str = "127.0.0.1";
pub const TEST_PORT: u16 = 2222;
pub const TEST_USER: &str = "test";
pub const TEST_PASSWORD: &str = "test123";

/// Perfil de contraseña apuntando al servidor de pruebas.
pub fn test_profile() -> ServerProfile {
    ServerProfile {
        id: "test-profile".into(),
        name: "Servidor de pruebas".into(),
        host: TEST_HOST.into(),
        port: TEST_PORT,
        username: TEST_USER.into(),
        auth: AuthMethod::Password,
        key_path: None,
        default_path: None,
        color: None,
        tmux: None,
        sudo_mode: Default::default(),
    }
}

/// Conecta al servidor de pruebas aceptando su huella sin tocar ~/.ssh/known_hosts.
/// DUEÑO: agente SSH (lo implementa primero que nada).
pub async fn connect_test_server() -> Arc<SshSession> {
    match super::connect_policy(&test_profile(), test_creds(), HostKeyPolicy::AcceptAny).await {
        Ok((s, _)) => Arc::new(s),
        Err(e) => panic!("no se pudo conectar al servidor de pruebas {TEST_HOST}:{TEST_PORT}: {e}"),
    }
}

/// Credenciales del servidor de pruebas.
pub fn test_creds() -> Credentials {
    Credentials {
        password: Some(TEST_PASSWORD.into()),
        ..Default::default()
    }
}
