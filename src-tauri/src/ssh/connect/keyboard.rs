//! keyboard-interactive: contraseña y/o código 2FA, según lo que pregunte el servidor.

use russh::client::{Handle, KeyboardInteractiveAuthResponse};

use super::auth::{AuthCtx, Step};
use super::{WRONG_OTP_MSG, WRONG_PASSWORD_MSG};
use crate::error::{AppError, AppResult};
use crate::ssh::handler::ClientHandler;

/// Qué pide una pregunta de keyboard-interactive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PromptKind {
    /// La contraseña de la cuenta.
    Password,
    /// Un código de segundo factor (OTP, token, verificación…).
    Code,
}

/// Palabras que indican un código de segundo factor (se comprueban antes que las de contraseña:
/// "One-time password" es un código).
const CODE_WORDS: &[&str] = &[
    "code",
    "código",
    "codigo",
    "verification",
    "verificación",
    "verificacion",
    "otp",
    "token",
    "one-time",
    "one time",
    "2fa",
    "two-factor",
    "two factor",
    "authenticator",
    "passcode",
];
const PASSWORD_WORDS: &[&str] = &[
    "password",
    "contraseña",
    "contrasena",
    "passphrase",
    "passwort",
    "mot de passe",
    "senha",
];

/// Clasifica una pregunta del servidor. Sin pistas en el texto: con eco apagado se trata
/// como contraseña; con eco (p. ej. "Passcode or option (1-3)") como un dato a pedir al usuario.
pub(crate) fn classify_prompt(prompt: &str, echo: bool) -> PromptKind {
    let p = prompt.to_lowercase();
    if CODE_WORDS.iter().any(|w| p.contains(w)) {
        PromptKind::Code
    } else if PASSWORD_WORDS.iter().any(|w| p.contains(w)) || !echo {
        PromptKind::Password
    } else {
        PromptKind::Code
    }
}

/// Texto de la pregunta para mostrar al usuario (`NeedsOtp`).
pub(super) fn prompt_text(prompt: &str) -> String {
    let t = prompt.trim();
    if t.is_empty() {
        "Código de verificación".to_string()
    } else {
        t.to_string()
    }
}

/// keyboard-interactive en varias rondas: contraseña y/o código 2FA.
pub(super) async fn auth_keyboard_interactive(
    handle: &mut Handle<ClientHandler>,
    ctx: &mut AuthCtx<'_>,
) -> AppResult<Step> {
    ctx.ki_rounds += 1;
    let mut resp = handle
        .authenticate_keyboard_interactive_start(ctx.user, None::<String>)
        .await?;
    let mut sent_password = false;
    let mut sent_code = false;
    for _ in 0..10 {
        match resp {
            KeyboardInteractiveAuthResponse::Success => return Ok(Step::Done),
            KeyboardInteractiveAuthResponse::Failure {
                partial_success: true,
                remaining_methods,
            } => return Ok(Step::Partial(remaining_methods)),
            KeyboardInteractiveAuthResponse::Failure { .. } => {
                let msg = if sent_code {
                    WRONG_OTP_MSG
                } else if sent_password || ctx.used_password {
                    // (también si el método "password" ya la había rechazado)
                    WRONG_PASSWORD_MSG
                } else {
                    "el servidor rechazó la autenticación interactiva"
                };
                return Err(AppError::AuthFailed(msg.into()));
            }
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                let mut answers = Vec::with_capacity(prompts.len());
                let (mut asked_password, mut asked_code) = (false, false);
                for p in &prompts {
                    match classify_prompt(&p.prompt, p.echo) {
                        PromptKind::Password => {
                            // Volver a pedirla en otra ronda = la anterior era incorrecta.
                            if sent_password {
                                return Err(AppError::AuthFailed(WRONG_PASSWORD_MSG.into()));
                            }
                            let Some(pw) = ctx.password else {
                                return Err(AppError::NeedsPassword);
                            };
                            asked_password = true;
                            answers.push(pw.to_string());
                        }
                        PromptKind::Code => {
                            if sent_code {
                                return Err(AppError::AuthFailed(WRONG_OTP_MSG.into()));
                            }
                            let Some(otp) = ctx.otp else {
                                return Err(AppError::NeedsOtp(prompt_text(&p.prompt)));
                            };
                            asked_code = true;
                            answers.push(otp.to_string());
                        }
                    }
                }
                sent_password |= asked_password;
                sent_code |= asked_code;
                resp = handle
                    .authenticate_keyboard_interactive_respond(answers)
                    .await?;
            }
        }
    }
    Err(AppError::AuthFailed(
        "el servidor no terminó la autenticación interactiva".into(),
    ))
}
