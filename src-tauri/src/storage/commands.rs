//! Comandos Tauri de perfiles, proyectos, secretos, ajustes y `~/.ssh/config`.

use tauri::{AppHandle, Manager, State};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::types::{Project, ProfilesData, ServerProfile, Settings, SshConfigExport};

use super::secrets::{self, SecretKind};
use super::{blocking, ssh_config, sudo_secret, vault, ProfileStore, SettingsStore};

/// Exporta a ~/.ssh/config si «Mantener sincronizado» está activo. Nunca falla: registra el error.
async fn sync_ssh_config(app: &AppHandle) {
    if !app.state::<SettingsStore>().get().ssh_config_sync {
        return;
    }
    let app = app.clone();
    let r = blocking(move || {
        let env = ssh_config::SshEnv::user()?;
        let store = app.state::<ProfileStore>();
        ssh_config::export_with(&env, || store.data().servers)
    })
    .await;
    if let Err(e) = r {
        log::error!("No se pudo sincronizar ~/.ssh/config: {e}");
    }
}

#[tauri::command]
pub async fn profiles_load(store: State<'_, ProfileStore>) -> AppResult<ProfilesData> {
    Ok(store.data())
}

/// Crea o actualiza un servidor y, si se indica `secret`, actualiza o borra su entrada en el llavero/bóveda.
#[tauri::command]
pub async fn profiles_save_server(
    app: AppHandle,
    store: State<'_, ProfileStore>,
    server: ServerProfile,
    secret: Option<String>,
) -> AppResult<ServerProfile> {
    let saved = store.save_server(server)?;
    sync_ssh_config(&app).await;
    if let Some(secret) = secret {
        let id = saved.id.clone();
        blocking(move || {
            if secret.is_empty() {
                secrets::delete_secret(&id)
            } else {
                secrets::set_secret(&id, &secret)
            }
        })
        .await?;
    }
    Ok(saved)
}

/// Borra el servidor, sus secretos (conexión y sudo) y sus referencias en proyectos.
#[tauri::command]
pub async fn profiles_delete_server(app: AppHandle, store: State<'_, ProfileStore>, id: String) -> AppResult<()> {
    store.delete_server(&id)?;
    let id_for_history = id.clone();
    sync_ssh_config(&app).await;
    if let Err(e) = blocking(move || secrets::delete_server_secrets(&id)).await {
        log::warn!("No se pudo borrar el secreto del servidor: {e}");
    }
    crate::vulnscan::store::forget_server(&id_for_history);
    crate::audit::store::forget_server(&id_for_history);
    Ok(())
}

#[tauri::command]
pub async fn profiles_save_project(store: State<'_, ProfileStore>, project: Project) -> AppResult<Project> {
    store.save_project(project)
}

#[tauri::command]
pub async fn profiles_delete_project(store: State<'_, ProfileStore>, id: String) -> AppResult<()> {
    store.delete_project(&id)
}

/// ¿Hay secreto guardado? `kind`: "login" (por defecto) o "sudo".
#[tauri::command]
pub async fn profiles_has_secret(id: String, kind: Option<SecretKind>) -> AppResult<bool> {
    let id = kind.unwrap_or_default().id(&id);
    blocking(move || secrets::get_secret(&id).map(|s| s.is_some())).await
}

/// Some(x) guarda, None borra. `kind`: "login" (por defecto) o "sudo".
#[tauri::command]
pub async fn profiles_set_secret(id: String, secret: Option<String>, kind: Option<SecretKind>) -> AppResult<()> {
    let id = kind.unwrap_or_default().id(&id);
    let secret = secret.map(Zeroizing::new);
    blocking(move || match secret.as_deref() {
        Some(s) if !s.is_empty() => secrets::set_secret(&id, s),
        _ => secrets::delete_secret(&id),
    })
    .await
}

/// Muestra un secreto guardado de un servidor (botón del ojo). Con bóveda pide el PIN o la contraseña.
#[tauri::command]
pub async fn profiles_reveal_secret(id: String, kind: SecretKind, pin: Option<String>) -> AppResult<Option<String>> {
    let pin = pin.map(Zeroizing::new);
    let id = kind.id(&id);
    blocking(move || {
        let v = vault::Vault::global();
        if v.is_enabled() {
            let pin = pin.ok_or_else(|| AppError::Invalid(format!("Escribe {}", v.pin_kind().noun())))?;
            v.check_pin(&pin)?;
        }
        secrets::get_secret(&id)
    })
    .await
}

/// Contraseña de sudo de un servidor según su ajuste: la de conexión, la guardada aparte o ninguna.
#[tauri::command]
pub async fn profiles_sudo_password(
    store: State<'_, ProfileStore>,
    sessions: State<'_, crate::ssh::SessionStore>,
    id: String,
    session_id: Option<String>,
) -> AppResult<Option<String>> {
    sudo_secret::resolve(&store, &sessions, &id, session_id.as_deref()).await
}

#[tauri::command]
pub async fn settings_load(store: State<'_, SettingsStore>) -> AppResult<Settings> {
    Ok(store.get())
}

#[tauri::command]
pub async fn settings_save(app: AppHandle, store: State<'_, SettingsStore>, settings: Settings) -> AppResult<Settings> {
    let was_synced = store.get().ssh_config_sync;
    let saved = store.save(settings)?;
    if saved.ssh_config_sync && !was_synced {
        sync_ssh_config(&app).await;
    }
    Ok(saved)
}

/// Copia un servidor (nombre "… (copia)") y sus secretos (conexión y sudo). Devuelve la copia.
#[tauri::command]
pub async fn profiles_duplicate_server(
    app: AppHandle,
    store: State<'_, ProfileStore>,
    id: String,
) -> AppResult<ServerProfile> {
    let copy = store.duplicate_server(&id)?;
    sync_ssh_config(&app).await;
    let new_id = copy.id.clone();
    let r = blocking(move || secrets::copy_server_secrets(&id, &new_id)).await;
    if let Err(e) = r {
        log::warn!("No se pudo copiar el secreto del servidor duplicado: {e}");
    }
    Ok(copy)
}

/// Escribe/actualiza el bloque marcado de SSHorus en ~/.ssh/config.
#[tauri::command]
pub async fn profiles_export_ssh_config(app: AppHandle) -> AppResult<SshConfigExport> {
    blocking(move || {
        let env = ssh_config::SshEnv::user()?;
        let store = app.state::<ProfileStore>();
        ssh_config::export_with(&env, || store.data().servers)
    })
    .await
}

/// Lee ~/.ssh/config y devuelve servidores candidatos (id "", sin guardar), omitiendo los ya existentes.
#[tauri::command]
pub async fn profiles_import_ssh_config(store: State<'_, ProfileStore>) -> AppResult<Vec<ServerProfile>> {
    let existing = store.data().servers;
    blocking(move || {
        let env = ssh_config::SshEnv::user()?;
        ssh_config::import(&env, &existing)
    })
    .await
}
