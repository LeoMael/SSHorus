//! Comandos Tauri del servidor MCP (estado, configuración, permisos, aprobaciones y actividad).

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::storage::vault::Vault;

use super::approval::{ApprovalRequest, Decision};
use super::audit::{self, AuditEntry};
use super::config::McpConfig;
use super::core::{AutoDuration, AutoState};
use super::policy::{Access, AutoLevel};
use super::{emit_auto, ensure_token, regenerate, ClientConfig, McpState, McpStatus};

fn shell_arg(s: &str) -> String {
    if s.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-./:=@\\".contains(&b)) {
        s.to_string()
    } else if cfg!(windows) {
        format!("\"{s}\"")
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

#[tauri::command]
pub async fn mcp_status(state: State<'_, McpState>) -> AppResult<McpStatus> {
    Ok(state.status())
}

/// Enciende o apaga el servidor MCP. Al encenderlo por primera vez se crea el token.
#[tauri::command]
pub async fn mcp_set_enabled(app: AppHandle, state: State<'_, McpState>, enabled: bool) -> AppResult<McpStatus> {
    if enabled {
        ensure_token(&state).await?;
    }
    state.core.config.update(|c| c.enabled = enabled)?;
    if enabled {
        // Si el puerto está ocupado, queda encendido con el error a la vista.
        let _ = state.start(&app);
    } else {
        state.stop(&app);
        state.set_error(None);
    }
    Ok(state.emit_status(&app))
}

#[tauri::command]
pub async fn mcp_set_port(app: AppHandle, state: State<'_, McpState>, port: u16) -> AppResult<McpStatus> {
    if port < 1024 {
        return Err(AppError::Invalid("Usa un puerto entre 1024 y 65535".into()));
    }
    state.core.config.update(|c| c.port = port)?;
    if state.config().enabled {
        let _ = state.start(&app);
    }
    Ok(state.emit_status(&app))
}

#[tauri::command]
pub async fn mcp_set_approval_timeout(state: State<'_, McpState>, secs: u32) -> AppResult<McpConfig> {
    state.core.config.update(|c| c.approval_timeout_secs = secs)
}

/// «La IA puede pedir la contraseña de sudo» (`request_sudo_password`; siempre pregunta).
#[tauri::command]
pub async fn mcp_set_sudo_password_request(state: State<'_, McpState>, allow: bool) -> AppResult<McpConfig> {
    state.core.config.update(|c| c.allow_sudo_password_request = allow)
}

#[tauri::command]
pub async fn mcp_config(state: State<'_, McpState>) -> AppResult<McpConfig> {
    Ok(state.config())
}

#[tauri::command]
pub async fn mcp_set_access(app: AppHandle, state: State<'_, McpState>, server_id: String, access: Access) -> AppResult<McpConfig> {
    state.core.config.update(|c| {
        c.access.insert(server_id.clone(), access);
    })?;
    if !access.allows_auto() {
        state.core.set_auto_at(&server_id, AutoLevel::Off, AutoDuration::Session, audit::now_ms())?;
        emit_auto(&app, &state);
    }
    Ok(state.core.config.get())
}

/// Servidores con «Aceptar automáticamente» activo ahora.
#[tauri::command]
pub async fn mcp_auto_list(state: State<'_, McpState>) -> AppResult<Vec<AutoState>> {
    Ok(state.core.auto_list_at(audit::now_ms()))
}

/// Activa o apaga «Aceptar automáticamente» en un servidor.
#[tauri::command]
pub async fn mcp_set_auto(
    app: AppHandle,
    state: State<'_, McpState>,
    server_id: String,
    level: AutoLevel,
    duration: AutoDuration,
) -> AppResult<Vec<AutoState>> {
    if level != AutoLevel::Off && Vault::global().status().locked {
        return Err(AppError::Locked);
    }
    state.core.set_auto_at(&server_id, level, duration, audit::now_ms())?;
    log::info!("MCP: aceptar automáticamente en {server_id}: {level:?} ({duration:?})");
    Ok(emit_auto(&app, &state))
}

/// Apaga «Aceptar automáticamente» en todos los servidores.
#[tauri::command]
pub async fn mcp_auto_off_all(app: AppHandle, state: State<'_, McpState>) -> AppResult<Vec<AutoState>> {
    state.core.auto_off_all()?;
    log::info!("MCP: aceptar automáticamente apagado en todos los servidores");
    Ok(emit_auto(&app, &state))
}

/// Borra una regla «Permitir siempre» de un servidor (o todas si `key` es None).
#[tauri::command]
pub async fn mcp_forget_rule(state: State<'_, McpState>, server_id: String, key: Option<String>) -> AppResult<McpConfig> {
    state.core.config.update(|c| match key {
        Some(k) => {
            if let Some(set) = c.remembered.get_mut(&server_id) {
                set.remove(&k);
            }
        }
        None => {
            c.remembered.remove(&server_id);
        }
    })
}

/// El token actual (para verlo o copiarlo). SSHorus tiene que estar desbloqueado.
#[tauri::command]
pub async fn mcp_get_token(state: State<'_, McpState>) -> AppResult<String> {
    Ok(ensure_token(&state).await?.to_string())
}

/// Crea un token nuevo: los clientes configurados con el anterior dejan de funcionar.
#[tauri::command]
pub async fn mcp_regenerate_token(app: AppHandle, state: State<'_, McpState>) -> AppResult<String> {
    let t = regenerate(&state).await?;
    log::info!("MCP: token regenerado");
    state.emit_status(&app);
    Ok(t.to_string())
}

/// Configuración para copiar en Claude Code y Claude Desktop (lleva el token).
#[tauri::command]
pub async fn mcp_client_config(state: State<'_, McpState>) -> AppResult<ClientConfig> {
    let token = ensure_token(&state).await?;
    let st = state.status();
    let bridge = st.bridge_path.clone();
    let desktop = serde_json::json!({
        "mcpServers": {
            "sshorus": {
                "command": bridge,
                "args": [],
                "env": { "SSHORUS_MCP_TOKEN": token.as_str() }
            }
        }
    });
    Ok(ClientConfig {
        claude_code_stdio: format!(
            "claude mcp add --env SSHORUS_MCP_TOKEN={} --transport stdio sshorus -- {}",
            token.as_str(),
            shell_arg(&bridge)
        ),
        claude_code_http: format!(
            "claude mcp add --transport http sshorus {} --header \"Authorization: Bearer {}\"",
            st.url,
            token.as_str()
        ),
        claude_desktop_json: serde_json::to_string_pretty(&desktop).unwrap_or_default(),
        url: st.url,
        token: token.to_string(),
    })
}

#[tauri::command]
pub async fn mcp_pending_approvals(state: State<'_, McpState>) -> AppResult<Vec<ApprovalRequest>> {
    Ok(state.pending.list())
}

/// Respuesta del diálogo de permiso. false si ya no estaba pendiente.
#[tauri::command]
pub async fn mcp_approval_reply(state: State<'_, McpState>, id: String, decision: Decision) -> AppResult<bool> {
    Ok(state.pending.reply(&id, decision))
}

/// Respuesta de la interfaz a una petición `mcp://ui-request`.
#[tauri::command]
pub async fn mcp_ui_reply(
    state: State<'_, McpState>,
    id: String,
    ok: bool,
    value: Option<Value>,
    error: Option<String>,
) -> AppResult<bool> {
    let result = if ok {
        Ok(value.unwrap_or(Value::Null))
    } else {
        Err(error.unwrap_or_else(|| "error en la ventana de SSHorus".into()))
    };
    Ok(state.ui.reply(&id, result))
}

/// Actividad reciente del asistente (lo más nuevo primero).
#[tauri::command]
pub async fn mcp_activity(state: State<'_, McpState>) -> AppResult<Vec<AuditEntry>> {
    Ok(state.core.audit.list())
}

/// Vacía la lista del panel (el archivo de registro se conserva).
#[tauri::command]
pub async fn mcp_activity_clear(state: State<'_, McpState>) -> AppResult<()> {
    state.core.audit.clear_recent();
    Ok(())
}
