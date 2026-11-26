//! Compartir e importar colecciones de comandos por gist o por un archivo de GitHub.

use super::api::{self, GhGistInfo};
use super::token::{stored_token, token};
use super::{http, share};
use crate::error::{AppError, AppResult};
use crate::types::Snippet;

/// Lee una colección de comandos de un gist o de un archivo de GitHub (vista previa; no guarda).
pub async fn fetch(source: &str) -> AppResult<Vec<Snippet>> {
    let t = stored_token().await.ok().flatten();
    let text = match share::resolve(source)? {
        share::Source::Gist(id) => {
            let g = api::gist(t.as_deref(), &id).await?;
            let files = g.all_files();
            let f = files
                .iter()
                .find(|f| {
                    f.filename
                        .as_deref()
                        .is_some_and(|n| n.to_ascii_lowercase().ends_with(".json"))
                })
                .or(files.first())
                .ok_or_else(|| AppError::NotFound("el gist está vacío".into()))?;
            api::gist_file_content(t.as_deref(), f).await?
        }
        share::Source::Raw(url) => {
            let r = http::get_url(t.as_deref(), &url, 2 * 1024 * 1024).await?;
            String::from_utf8(r.body)
                .map_err(|_| AppError::Invalid("el archivo no es texto".into()))?
        }
    };
    share::parse_collection(&text)
}

/// Publica una colección de comandos en un gist nuevo (secreto salvo `public`).
pub async fn share(
    snippets: Vec<Snippet>,
    description: String,
    public: bool,
) -> AppResult<GhGistInfo> {
    if snippets.is_empty() {
        return Err(AppError::Invalid("elige al menos un comando".into()));
    }
    if snippets.len() > share::MAX_SNIPPETS {
        return Err(AppError::Invalid("demasiados comandos".into()));
    }
    let content = share::to_collection(&snippets)?;
    let desc = description.trim();
    let desc = if desc.is_empty() {
        "Comandos de SSHorus"
    } else {
        desc
    };
    let g = api::save_gist(
        &token().await?,
        None,
        desc,
        public,
        &[("sshorus-comandos.json", content)],
    )
    .await?;
    Ok(g.info())
}
