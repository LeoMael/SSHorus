//! Llamadas concretas a la API REST de GitHub y sus tipos (espejo en `src/api/github.ts`).
//! Actions y Gists viven en `api_gists.rs` y se re-exportan desde aquí.

use base64ct::{Base64, Encoding};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::http;
use crate::error::{AppError, AppResult};

pub use super::api_gists::*;

// ───────── Validación de nombres (evita construir rutas raras) ─────────

pub fn valid_login(s: &str) -> bool {
    !s.is_empty() && s.len() <= 39 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn valid_repo_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s != "."
        && s != ".."
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

pub fn check_repo(owner: &str, repo: &str) -> AppResult<()> {
    if valid_login(owner) && valid_repo_name(repo) {
        Ok(())
    } else {
        Err(AppError::Invalid("nombre de repositorio no válido".into()))
    }
}

pub fn valid_gist_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

// ───────── Cuenta ─────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhAccount {
    pub login: String,
    pub name: Option<String>,
    pub html_url: String,
    pub avatar_data: Option<String>,
    pub public_repos: u64,
    pub private_repos: Option<u64>,
    pub token_kind: String,
    pub scopes: Option<Vec<String>>,
    pub token_expires: Option<String>,
    pub rate_limit: Option<u64>,
    pub rate_remaining: Option<u64>,
}

#[derive(Deserialize)]
struct RawUser {
    login: String,
    name: Option<String>,
    html_url: String,
    avatar_url: Option<String>,
    #[serde(default)]
    public_repos: u64,
    total_private_repos: Option<u64>,
}

pub fn token_kind(token: &str) -> &'static str {
    if token.starts_with("ghp_") {
        "classic"
    } else if token.starts_with("github_pat_") {
        "fine-grained"
    } else if token.starts_with("gho_") || token.starts_with("ghu_") {
        "oauth"
    } else {
        "other"
    }
}

/// Lista de permisos de `X-OAuth-Scopes` ("repo, gist" → ["repo","gist"]).
pub fn parse_scopes(header: Option<&str>) -> Option<Vec<String>> {
    header.map(|h| {
        h.split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    })
}

pub async fn account(token: &str) -> AppResult<GhAccount> {
    let r = http::api(Some(token), Method::GET, "/user", None).await?;
    let u: RawUser = r.json()?;
    let num = |h: &str| r.header(h).and_then(|v| v.trim().parse::<u64>().ok());
    let avatar_data = match u.avatar_url.as_deref() {
        Some(url) => avatar(url).await.ok(),
        None => None,
    };
    Ok(GhAccount {
        login: u.login,
        name: u.name.filter(|n| !n.trim().is_empty()),
        html_url: u.html_url,
        avatar_data,
        public_repos: u.public_repos,
        private_repos: u.total_private_repos,
        token_kind: token_kind(token).into(),
        scopes: parse_scopes(r.header("x-oauth-scopes")),
        token_expires: r
            .header("github-authentication-token-expiration")
            .map(str::to_string),
        rate_limit: num("x-ratelimit-limit"),
        rate_remaining: num("x-ratelimit-remaining"),
    })
}

/// Descarga el avatar (pequeño) y lo devuelve como `data:` URL.
async fn avatar(url: &str) -> AppResult<String> {
    let sep = if url.contains('?') { '&' } else { '?' };
    let r = http::get_url(None, &format!("{url}{sep}s=96"), 512 * 1024).await?;
    let ct = r.header("content-type").unwrap_or("image/png").to_string();
    if !ct.starts_with("image/") {
        return Err(AppError::Invalid("el avatar no es una imagen".into()));
    }
    Ok(format!(
        "data:{ct};base64,{}",
        Base64::encode_string(&r.body)
    ))
}

// ───────── Llaves SSH de la cuenta ─────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhSshKey {
    pub id: u64,
    pub key: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, alias = "created_at")]
    pub created_at: Option<String>,
}

pub async fn my_keys(token: &str) -> AppResult<Vec<GhSshKey>> {
    http::api_json(Some(token), "/user/keys?per_page=100").await
}

/// Llaves públicas de cualquier usuario (no necesita token).
pub async fn user_keys(token: Option<&str>, login: &str) -> AppResult<Vec<GhSshKey>> {
    if !valid_login(login) {
        return Err(AppError::Invalid(
            "nombre de usuario de GitHub no válido".into(),
        ));
    }
    http::api_json(token, &format!("/users/{login}/keys")).await
}

pub async fn add_key(token: &str, title: &str, key: &str) -> AppResult<GhSshKey> {
    let body = json!({ "title": title, "key": key });
    http::api(Some(token), Method::POST, "/user/keys", Some(&body))
        .await?
        .json()
}

// ───────── Repositorios ─────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhRepo {
    #[serde(alias = "full_name")]
    pub full_name: String,
    pub name: String,
    pub owner: String,
    pub private: bool,
    pub archived: bool,
    pub fork: bool,
    pub default_branch: String,
    pub ssh_url: String,
    pub clone_url: String,
    pub html_url: String,
    pub description: Option<String>,
    pub pushed_at: Option<String>,
}

#[derive(Deserialize)]
struct RawOwner {
    login: String,
}

#[derive(Deserialize)]
struct RawRepo {
    full_name: String,
    name: String,
    owner: RawOwner,
    #[serde(default)]
    private: bool,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    fork: bool,
    #[serde(default)]
    default_branch: Option<String>,
    ssh_url: String,
    clone_url: String,
    html_url: String,
    description: Option<String>,
    pushed_at: Option<String>,
}

impl From<RawRepo> for GhRepo {
    fn from(r: RawRepo) -> Self {
        GhRepo {
            full_name: r.full_name,
            name: r.name,
            owner: r.owner.login,
            private: r.private,
            archived: r.archived,
            fork: r.fork,
            default_branch: r.default_branch.unwrap_or_else(|| "main".into()),
            ssh_url: r.ssh_url,
            clone_url: r.clone_url,
            html_url: r.html_url,
            description: r.description,
            pushed_at: r.pushed_at,
        }
    }
}

pub fn parse_repos(body: &[u8]) -> AppResult<Vec<GhRepo>> {
    let raw: Vec<RawRepo> = serde_json::from_slice(body)
        .map_err(|e| AppError::Invalid(format!("respuesta de GitHub inesperada: {e}")))?;
    Ok(raw.into_iter().map(GhRepo::from).collect())
}

/// Repos del usuario (propios, de colaborador y de sus organizaciones), los más recientes primero.
pub async fn repos(token: &str) -> AppResult<Vec<GhRepo>> {
    let mut all = Vec::new();
    for page in 1..=10 {
        let r = http::api(
            Some(token),
            Method::GET,
            &format!("/user/repos?per_page=100&sort=pushed&page={page}"),
            None,
        )
        .await?;
        let list = parse_repos(&r.body)?;
        let n = list.len();
        all.extend(list);
        if n < 100 {
            break;
        }
    }
    Ok(all)
}

#[derive(Deserialize)]
struct RawBranch {
    name: String,
}

pub async fn branches(token: &str, owner: &str, repo: &str) -> AppResult<Vec<String>> {
    check_repo(owner, repo)?;
    let mut out = Vec::new();
    for page in 1..=5 {
        let list: Vec<RawBranch> = http::api_json(
            Some(token),
            &format!("/repos/{owner}/{repo}/branches?per_page=100&page={page}"),
        )
        .await?;
        let n = list.len();
        out.extend(list.into_iter().map(|b| b.name));
        if n < 100 {
            break;
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhDeployKey {
    pub id: u64,
    pub title: Option<String>,
    #[serde(default, alias = "read_only")]
    pub read_only: bool,
}

pub async fn add_deploy_key(
    token: &str,
    owner: &str,
    repo: &str,
    title: &str,
    key: &str,
    read_only: bool,
) -> AppResult<GhDeployKey> {
    check_repo(owner, repo)?;
    let body = json!({ "title": title, "key": key, "read_only": read_only });
    http::api(
        Some(token),
        Method::POST,
        &format!("/repos/{owner}/{repo}/keys"),
        Some(&body),
    )
    .await?
    .json()
}
