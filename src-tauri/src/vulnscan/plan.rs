//! Qué script pide cada fase y qué hacer tras cada una: el plan tras detectar el sistema, los usuarios
//! con contenedores y qué imágenes se leen. Lo decide el motor para que interfaz y MCP hagan lo mismo.

use serde::{Deserialize, Serialize};

use super::ecosystem;
use super::model::*;
use super::parse::inventory::{self, StoreUser};
use super::scripts::{self, UserCtx};

/// Petición de un script (ver `scripts/`).
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ScriptRequest {
    Detect,
    Users,
    Inventory,
    #[serde(rename_all = "camelCase")]
    Distro { tool: DistroTool, codename: Option<String> },
    #[serde(rename_all = "camelCase")]
    Images { engine: Engine, user: Option<UserCtx> },
    #[serde(rename_all = "camelCase")]
    Image { engine: Engine, user: Option<UserCtx>, image_id: String, trivy: bool },
    /// «Actualizar imagen»: comandos ya revisados por el usuario, como el dueño de la imagen.
    /// Solo la interfaz lo pide (no es una herramienta del MCP).
    #[serde(rename_all = "camelCase")]
    AsOwner { engine: Engine, user: Option<UserCtx>, script: String },
}

pub fn script_for(req: &ScriptRequest) -> String {
    match req {
        ScriptRequest::Detect => scripts::detect_script(),
        ScriptRequest::Users => scripts::users_script(),
        ScriptRequest::Inventory => scripts::inventory_script(),
        ScriptRequest::Distro { tool, codename } => scripts::distro_script(*tool, codename.as_deref().unwrap_or("")),
        ScriptRequest::Images { engine, user } => scripts::images_list_script(*engine, user.as_ref()),
        ScriptRequest::Image { engine, user, image_id, trivy } => scripts::image_script(*engine, user.as_ref(), image_id, *trivy),
        ScriptRequest::AsOwner { engine, user, script } => scripts::as_owner_script(*engine, user.as_ref(), script),
    }
}

/// Qué hacer después de la fase 1 (lo decide el motor para que interfaz y MCP hagan lo mismo).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanPlan {
    pub os: String,
    pub ecosystem: Option<String>,
    pub distro_tool: Option<DistroTool>,
    pub codename: String,
    pub trivy: Option<String>,
    pub podman: bool,
    /// Docker responde para el usuario conectado.
    pub docker: bool,
    pub user: String,
    pub is_root: bool,
    pub in_container: bool,
    pub complete: bool,
}

pub fn plan_from(detect_stdout: &str) -> ScanPlan {
    let d = inventory::parse_detect(detect_stdout);
    ScanPlan {
        os: d.os.display(),
        ecosystem: ecosystem::for_os(&d.os),
        distro_tool: ecosystem::distro_tool(&d),
        codename: d.os.version_codename.clone(),
        trivy: d.trivy_version.clone().or_else(|| d.has("trivy").then(|| "?".into())),
        podman: d.has("podman"),
        docker: d.has("docker") && d.docker_ok,
        user: d.user.clone(),
        is_root: d.uid == Some(0),
        in_container: d.in_container,
        complete: d.complete,
    }
}

/// Usuarios con almacén de contenedores (salida de `users_script`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsersView {
    pub users: Vec<StoreUser>,
    pub root_podman: bool,
    pub root_docker: bool,
}

/// Lee la salida de `users_script`.
pub fn users_view(output: &str) -> UsersView {
    let u = inventory::parse_users(output);
    UsersView { users: u.users, root_podman: u.root_podman, root_docker: u.root_docker }
}

/// Imágenes que se van a leer, en orden: primero las que usan contenedores, luego las etiquetadas.
/// Las que no tienen etiqueta ni contenedores no se leen (restos de compilaciones).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagesView {
    pub selected: Vec<ImageInfo>,
    pub total: usize,
    pub error: Option<String>,
}

pub fn select_images(engine: Engine, output: &str, limit: usize) -> ImagesView {
    let l = inventory::parse_images(engine, output);
    let total = l.images.len();
    let mut imgs: Vec<ImageInfo> = l.images.into_iter().filter(|i| !i.tags.is_empty() || !i.containers.is_empty()).collect();
    imgs.sort_by_key(|i| (i.containers.is_empty(), i.tags.is_empty()));
    imgs.truncate(limit.max(1));
    ImagesView { selected: imgs, total, error: l.error }
}
