//! Autenticación: el método del perfil y, si el servidor lo pide, los siguientes («partial success»).

use std::sync::Arc;

use russh::client::{AuthResult, Handle};
use russh::keys::PrivateKeyWithHashAlg;
use russh::MethodKind;

use super::agent::auth_agent;
use super::keyboard::auth_keyboard_interactive;
use super::WRONG_PASSWORD_MSG;
use crate::error::{AppError, AppResult};
use crate::ssh::handler::ClientHandler;
use crate::types::AuthMethod;

fn methods_text(m: &russh::MethodSet) -> String {
    let v: Vec<&'static str> = m.iter().map(<&'static str>::from).collect();
    if v.is_empty() {
        "ninguno".into()
    } else {
        v.join(", ")
    }
}

/// Estado de la autenticación (puede encadenar varios métodos: "partial success").
pub(super) struct AuthCtx<'a> {
    pub(super) user: &'a str,
    pub(super) password: Option<&'a str>,
    pub(super) otp: Option<&'a str>,
    pub(super) key: Option<Arc<russh::keys::PrivateKey>>,
    pub(super) used_password: bool,
    pub(super) used_key: bool,
    pub(super) ki_rounds: u8,
}

/// Resultado de un método de autenticación aceptado.
pub(super) enum Step {
    /// Autenticado.
    Done,
    /// El método se aceptó pero el servidor exige otro (p. ej. llave + código).
    Partial(russh::MethodSet),
}

fn second_method_error(remaining: &russh::MethodSet) -> AppError {
    AppError::AuthFailed(format!(
        "el servidor exige un segundo método de autenticación ({})",
        methods_text(remaining)
    ))
}

/// Autentica con el método del perfil y, si el servidor lo pide, con los siguientes.
pub(super) async fn authenticate(
    handle: &mut Handle<ClientHandler>,
    method: AuthMethod,
    ctx: &mut AuthCtx<'_>,
) -> AppResult<()> {
    let mut step = match method {
        AuthMethod::Password => auth_password(handle, ctx).await?,
        AuthMethod::Key => auth_key(handle, ctx).await?,
        AuthMethod::Agent => auth_agent(handle, ctx.user).await?,
    };
    for _ in 0..4 {
        match step {
            Step::Done => return Ok(()),
            Step::Partial(remaining) => step = next_method(handle, ctx, &remaining).await?,
        }
    }
    Err(AppError::AuthFailed(
        "el servidor no terminó la autenticación (demasiados pasos)".into(),
    ))
}

/// Tras un "partial success": elige el siguiente método que podemos ofrecer.
async fn next_method(
    handle: &mut Handle<ClientHandler>,
    ctx: &mut AuthCtx<'_>,
    remaining: &russh::MethodSet,
) -> AppResult<Step> {
    if remaining.contains(&MethodKind::KeyboardInteractive) && ctx.ki_rounds < 2 {
        return auth_keyboard_interactive(handle, ctx).await;
    }
    if remaining.contains(&MethodKind::Password) && !ctx.used_password {
        if ctx.password.is_none() {
            return Err(AppError::NeedsPassword);
        }
        return auth_password(handle, ctx).await;
    }
    if remaining.contains(&MethodKind::PublicKey) && !ctx.used_key && ctx.key.is_some() {
        return auth_key(handle, ctx).await;
    }
    Err(second_method_error(remaining))
}

async fn auth_password(handle: &mut Handle<ClientHandler>, ctx: &mut AuthCtx<'_>) -> AppResult<Step> {
    let Some(password) = ctx.password else {
        return Err(AppError::NeedsPassword);
    };
    ctx.used_password = true;
    let res = handle.authenticate_password(ctx.user, password).await?;
    let remaining = match res {
        AuthResult::Success => return Ok(Step::Done),
        AuthResult::Failure {
            remaining_methods,
            partial_success: true,
        } => return Ok(Step::Partial(remaining_methods)),
        AuthResult::Failure {
            remaining_methods, ..
        } => remaining_methods,
    };
    // Muchos servidores (PAM) solo aceptan keyboard-interactive para contraseñas.
    if remaining.contains(&MethodKind::KeyboardInteractive) && ctx.ki_rounds == 0 {
        return auth_keyboard_interactive(handle, ctx).await;
    }
    if !remaining.contains(&MethodKind::Password) && !remaining.is_empty() {
        return Err(AppError::AuthFailed(format!(
            "el servidor no acepta contraseña para este usuario (métodos permitidos: {})",
            methods_text(&remaining)
        )));
    }
    Err(AppError::AuthFailed(WRONG_PASSWORD_MSG.into()))
}

async fn auth_key(handle: &mut Handle<ClientHandler>, ctx: &mut AuthCtx<'_>) -> AppResult<Step> {
    let Some(key) = ctx.key.clone() else {
        return Err(AppError::Invalid("No se pudo cargar la llave".into()));
    };
    ctx.used_key = true;
    let hash = handle.best_supported_rsa_hash().await?.flatten();
    let res = handle
        .authenticate_publickey(ctx.user, PrivateKeyWithHashAlg::new(key, hash))
        .await?;
    match res {
        AuthResult::Success => Ok(Step::Done),
        AuthResult::Failure {
            partial_success: true,
            remaining_methods,
        } => Ok(Step::Partial(remaining_methods)),
        AuthResult::Failure { .. } => Err(AppError::AuthFailed(
            "el servidor rechazó la llave (¿está en authorized_keys de ese usuario?)".into(),
        )),
    }
}
