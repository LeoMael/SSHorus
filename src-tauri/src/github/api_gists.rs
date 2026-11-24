//! Endpoints de GitHub Actions y Gists (tipos y llamadas HTTP).

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::api::{check_repo, valid_gist_id};
use super::http::{self, Resp};
use crate::error::{AppError, AppResult};

// ───────── Actions ─────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhWorkflow {
    pub id: u64,
    pub name: String,
    pub path: String,
    pub state: String,
    #[serde(alias = "html_url")]
    pub html_url: String,
}

#[derive(Deserialize)]
struct RawWorkflows {
    workflows: Vec<GhWorkflow>,
}

pub async fn workflows(token: &str, owner: &str, repo: &str) -> AppResult<Vec<GhWorkflow>> {
    check_repo(owner, repo)?;
    let r: RawWorkflows = http::api_json(
        Some(token),
        &format!("/repos/{owner}/{repo}/actions/workflows?per_page=100"),
    )
    .await?;
    Ok(r.workflows)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhRun {
    pub id: u64,
    pub name: Option<String>,
    #[serde(alias = "display_title")]
    pub display_title: Option<String>,
    #[serde(alias = "workflow_id")]
    pub workflow_id: u64,
    #[serde(alias = "run_number")]
    pub run_number: u64,
    pub status: Option<String>,
    pub conclusion: Option<String>,
    #[serde(alias = "head_branch")]
    pub head_branch: Option<String>,
    pub event: Option<String>,
    #[serde(alias = "html_url")]
    pub html_url: String,
    #[serde(alias = "created_at")]
    pub created_at: Option<String>,
    #[serde(alias = "updated_at")]
    pub updated_at: Option<String>,
}

#[derive(Deserialize)]
struct RawRuns {
    workflow_runs: Vec<GhRun>,
}

pub fn parse_runs(body: &[u8]) -> AppResult<Vec<GhRun>> {
    let r: RawRuns = serde_json::from_slice(body)
        .map_err(|e| AppError::Invalid(format!("respuesta de GitHub inesperada: {e}")))?;
    Ok(r.workflow_runs)
}

pub async fn runs(token: &str, owner: &str, repo: &str, limit: u32) -> AppResult<Vec<GhRun>> {
    check_repo(owner, repo)?;
    let n = limit.clamp(1, 100);
    let r = http::api(
        Some(token),
        Method::GET,
        &format!("/repos/{owner}/{repo}/actions/runs?per_page={n}"),
        None,
    )
    .await?;
    parse_runs(&r.body)
}

pub async fn dispatch(
    token: &str,
    owner: &str,
    repo: &str,
    workflow_id: u64,
    git_ref: &str,
    inputs: &serde_json::Map<String, serde_json::Value>,
) -> AppResult<()> {
    check_repo(owner, repo)?;
    if git_ref.trim().is_empty() {
        return Err(AppError::Invalid("indica la rama".into()));
    }
    let body = json!({ "ref": git_ref, "inputs": inputs });
    http::api(
        Some(token),
        Method::POST,
        &format!("/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches"),
        Some(&body),
    )
    .await?;
    Ok(())
}

// ───────── Gists ─────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhGistInfo {
    pub id: String,
    pub html_url: String,
    pub description: Option<String>,
    pub updated_at: Option<String>,
    pub public: bool,
    pub files: Vec<String>,
}

#[derive(Deserialize)]
pub struct RawGistFile {
    pub filename: Option<String>,
    pub content: Option<String>,
    #[serde(default)]
    pub truncated: bool,
    pub raw_url: Option<String>,
}

#[derive(Deserialize)]
pub struct RawGist {
    pub id: String,
    pub html_url: String,
    pub description: Option<String>,
    pub updated_at: Option<String>,
    #[serde(default)]
    pub public: bool,
    #[serde(default)]
    pub files: serde_json::Map<String, serde_json::Value>,
}

impl RawGist {
    pub fn info(&self) -> GhGistInfo {
        GhGistInfo {
            id: self.id.clone(),
            html_url: self.html_url.clone(),
            description: self.description.clone(),
            updated_at: self.updated_at.clone(),
            public: self.public,
            files: self.files.keys().cloned().collect(),
        }
    }

    pub fn file(&self, name: &str) -> Option<RawGistFile> {
        self.files
            .get(name)
            .and_then(|v| serde_json::from_value(v.clone()).ok())
    }

    pub fn all_files(&self) -> Vec<RawGistFile> {
        self.files
            .values()
            .filter_map(|v| serde_json::from_value(v.clone()).ok())
            .collect()
    }
}

pub async fn gists(token: &str) -> AppResult<Vec<RawGist>> {
    let mut all = Vec::new();
    for page in 1..=5 {
        let list: Vec<RawGist> =
            http::api_json(Some(token), &format!("/gists?per_page=100&page={page}")).await?;
        let n = list.len();
        all.extend(list);
        if n < 100 {
            break;
        }
    }
    Ok(all)
}

pub async fn gist(token: Option<&str>, id: &str) -> AppResult<RawGist> {
    if !valid_gist_id(id) {
        return Err(AppError::Invalid("identificador de gist no válido".into()));
    }
    http::api_json(token, &format!("/gists/{id}")).await
}

/// Contenido completo de un archivo de gist (si vino recortado, lo baja de `raw_url`).
pub async fn gist_file_content(token: Option<&str>, f: &RawGistFile) -> AppResult<String> {
    match (&f.content, f.truncated, &f.raw_url) {
        (Some(c), false, _) => Ok(c.clone()),
        (_, _, Some(raw)) => {
            let r: Resp = http::get_url(token, raw, http::MAX_BODY).await?;
            String::from_utf8(r.body)
                .map_err(|_| AppError::Invalid("el archivo no es texto".into()))
        }
        _ => Err(AppError::Invalid("el archivo del gist está vacío".into())),
    }
}

/// Crea un gist (o actualiza `id` si se da). `files`: nombre → contenido.
pub async fn save_gist(
    token: &str,
    id: Option<&str>,
    description: &str,
    public: bool,
    files: &[(&str, String)],
) -> AppResult<RawGist> {
    let mut map = serde_json::Map::new();
    for (name, content) in files {
        map.insert((*name).to_string(), json!({ "content": content }));
    }
    match id {
        Some(id) => {
            if !valid_gist_id(id) {
                return Err(AppError::Invalid("identificador de gist no válido".into()));
            }
            let body = json!({ "description": description, "files": map });
            http::api(
                Some(token),
                Method::PATCH,
                &format!("/gists/{id}"),
                Some(&body),
            )
            .await?
            .json()
        }
        None => {
            let body = json!({ "description": description, "public": public, "files": map });
            http::api(Some(token), Method::POST, "/gists", Some(&body))
                .await?
                .json()
        }
    }
}
