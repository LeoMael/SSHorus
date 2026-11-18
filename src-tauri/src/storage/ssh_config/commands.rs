//! Comandos Tauri de `~/.ssh/config` (alias y choques, vista previa de importación).

use std::collections::{BTreeMap, HashSet};

use tauri::{AppHandle, Manager, State};

use super::alias::{load_overrides, update_overrides, AliasOverrides};
use super::conflicts::{alias_info, conflicts, SshAliasConflict, SshAliasInfo};
use super::export::export_with;
use super::import::{import_preview, SshImportCandidate};
use super::SshEnv;
use crate::error::AppResult;
use crate::storage::{blocking, ProfileStore, SettingsStore};
use crate::types::{AuthMethod, ServerProfile};

/// Servidores cuyo alias choca con un `Host`/`Match` escrito a mano en `~/.ssh/config` (o sus `Include`).
#[tauri::command]
pub async fn ssh_config_conflicts(store: State<'_, ProfileStore>) -> AppResult<Vec<SshAliasConflict>> {
    let servers = store.data().servers;
    blocking(move || conflicts(&SshEnv::user()?, &servers)).await
}

/// Alias que tendría un servidor en edición (`id` vacío = nuevo) y si choca.
#[tauri::command]
pub async fn ssh_config_alias_info(
    store: State<'_, ProfileStore>,
    id: String,
    name: String,
    host: String,
    alias: Option<String>,
) -> AppResult<SshAliasInfo> {
    let servers = store.data().servers;
    let draft = ServerProfile {
        id,
        name: if name.trim().is_empty() { host.trim().to_string() } else { name.trim().to_string() },
        host: host.trim().to_string(),
        port: 22,
        username: String::new(),
        auth: AuthMethod::Password,
        key_path: None,
        default_path: None,
        color: None,
        tmux: None,
        sudo_mode: Default::default(),
    };
    blocking(move || alias_info(&SshEnv::user()?, &servers, draft, alias.as_deref())).await
}

/// Alias elegidos a mano (id del servidor → alias).
#[tauri::command]
pub async fn ssh_config_aliases() -> AppResult<AliasOverrides> {
    blocking(|| Ok(load_overrides(&SshEnv::user()?))).await
}

/// Cambia alias elegidos a mano (`null` o "" = automático). Si «Mantener sincronizado» está activo,
/// vuelve a exportar. Devuelve todos los alias elegidos a mano.
#[tauri::command]
pub async fn ssh_config_set_aliases(
    app: AppHandle,
    aliases: BTreeMap<String, Option<String>>,
) -> AppResult<AliasOverrides> {
    blocking(move || {
        let env = SshEnv::user()?;
        let store = app.state::<ProfileStore>();
        let ids: HashSet<String> = store.data().servers.into_iter().map(|s| s.id).collect();
        let map = update_overrides(&env, &aliases, &ids)?;
        if app.state::<SettingsStore>().get().ssh_config_sync
            && let Err(e) = export_with(&env, || store.data().servers)
        {
            log::error!("No se pudo sincronizar ~/.ssh/config: {e}");
        }
        Ok(map)
    })
    .await
}

/// Como `profiles_import_ssh_config`, pero incluye (marcados) los que ya están en SSHorus.
#[tauri::command]
pub async fn ssh_config_import_preview(store: State<'_, ProfileStore>) -> AppResult<Vec<SshImportCandidate>> {
    let existing = store.data().servers;
    blocking(move || import_preview(&SshEnv::user()?, &existing)).await
}
