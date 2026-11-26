//! HTTP con el servicio de IA: cliente sin redirecciones, cabecera del token, errores claros y
//! límite de tamaño de la respuesta.

use std::sync::OnceLock;
use std::time::Duration;

use reqwest::{Client, Url};

use super::MAX_BODY;
use crate::error::{AppError, AppResult};

pub(super) fn endpoint(base: &Url, path: &str) -> AppResult<Url> {
    let s = format!("{}/{}", base.as_str().trim_end_matches('/'), path);
    Url::parse(&s).map_err(|_| AppError::Invalid("URL no válida".into()))
}

pub(super) fn client() -> AppResult<&'static Client> {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let c = Client::builder()
        .user_agent("SSHorus")
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| AppError::Network(format!("no se pudo preparar la conexión: {e}")))?;
    Ok(CLIENT.get_or_init(|| c))
}

fn http_error(status: reqwest::StatusCode, body: &[u8]) -> AppError {
    let msg = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(|m| m.as_str()).map(str::to_string))
        .unwrap_or_default();
    let msg: String = msg.chars().take(300).collect();
    match status.as_u16() {
        401 | 403 => AppError::AuthFailed(format!("el servicio de IA rechazó el token. {msg}").trim().to_string()),
        404 => AppError::NotFound(format!("el modelo o la ruta en el servicio de IA. {msg}").trim().to_string()),
        429 => AppError::Network(format!("el servicio de IA pide esperar (demasiadas peticiones). {msg}").trim().to_string()),
        s => AppError::Network(format!("el servicio de IA respondió {s}. {msg}").trim().to_string()),
    }
}

pub(super) enum SendError {
    Http { status: reqwest::StatusCode, body: Vec<u8> },
    Other(AppError),
}

impl SendError {
    pub(super) fn into_app_error(self) -> AppError {
        match self {
            SendError::Http { status, body } => http_error(status, &body),
            SendError::Other(e) => e,
        }
    }
}

/// Algunos modelos (Claude con thinking, modelos de razonamiento de OpenAI…) rechazan `temperature`
/// con 400/422. Como `0.2` siempre está en rango, un rechazo que mencione `temperature` indica que
/// el modelo no admite el parámetro y conviene reintentar sin él.
pub(super) fn is_temperature_rejected(status: reqwest::StatusCode, body: &[u8]) -> bool {
    if !matches!(status.as_u16(), 400 | 422) {
        return false;
    }
    let msg = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(|m| m.as_str()).map(str::to_string))
        .unwrap_or_else(|| String::from_utf8_lossy(body).into_owned());
    msg.to_ascii_lowercase().contains("temperature")
}

pub(super) async fn send_raw(req: reqwest::RequestBuilder) -> Result<Vec<u8>, SendError> {
    let resp = req.send().await.map_err(|e| {
        SendError::Other(if e.is_timeout() {
            AppError::Network("el servicio de IA no respondió a tiempo".into())
        } else {
            AppError::Network(format!("no se pudo hablar con el servicio de IA: {}", e.without_url()))
        })
    })?;
    let status = resp.status();
    if status.is_redirection() {
        return Err(SendError::Other(AppError::Network(
            "el servicio de IA intentó redirigir: revisa la URL base".into(),
        )));
    }
    let body = resp.bytes().await.map_err(|e| SendError::Other(AppError::Network(e.without_url().to_string())))?;
    if body.len() > MAX_BODY {
        return Err(SendError::Other(AppError::Network("respuesta de la IA demasiado grande".into())));
    }
    if !status.is_success() {
        return Err(SendError::Http { status, body: body.to_vec() });
    }
    Ok(body.to_vec())
}

pub(super) async fn send(req: reqwest::RequestBuilder) -> AppResult<Vec<u8>> {
    send_raw(req).await.map_err(SendError::into_app_error)
}

pub(super) fn with_auth(req: reqwest::RequestBuilder, token: Option<&str>) -> AppResult<reqwest::RequestBuilder> {
    Ok(match token.filter(|t| !t.is_empty()) {
        Some(t) => {
            let mut v = reqwest::header::HeaderValue::from_str(&format!("Bearer {t}"))
                .map_err(|_| AppError::Invalid("El token tiene caracteres no válidos".into()))?;
            v.set_sensitive(true);
            req.header(reqwest::header::AUTHORIZATION, v)
        }
        None => req,
    })
}
