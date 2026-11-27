//! Punto de entrada del motor: registra estado global, plugins y todos los comandos.
//! Archivo de BASE: los agentes no lo editan; los comandos ya están todos registrados.

mod ai;
mod audit;
mod diagnostics;
mod dragout;
mod error;
mod foldersync;
mod github;
mod localfs;
mod localkeys;
mod localterm;
mod mcp;
mod pinch;
mod platform;
mod server_history;
mod sftp;
mod snippets;
mod ssh;
mod sshkeys;
mod storage;
mod terminal;
mod transfer;
mod tunnels;
mod types;
mod vulnscan;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    platform::prepare_environment();
    tauri::Builder::default()
        // Solo la ventana principal recuerda tamaño y posición (las de editor aparte son de usar y tirar).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filter(|label| label == "main")
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Linux: el pellizco del touchpad va al mapa y no agranda la app entera.
        .plugin(pinch::init())
        .manage(ssh::SessionStore::default())
        .manage(terminal::TerminalStore::default())
        .manage(localterm::LocalTermStore::default())
        .manage(sftp::SftpStore::default())
        .manage(transfer::TransferManager::default())
        .manage(foldersync::FolderSyncManager::default())
        .manage(snippets::ExecRegistry::default())
        .manage(storage::lock::LockState::default())
        // Al cerrar la principal se cierra la app entera (si no, seguirían vivas las ventanas de editor aparte).
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                // Las terminales locales terminan con sus procesos (no quedan programas sueltos).
                window.app_handle().state::<localterm::LocalTermStore>().close_all();
                window.app_handle().exit(0);
            }
        })
        .setup(|app| {
            app.manage(storage::ProfileStore::load());
            app.manage(storage::SettingsStore::load());
            // Bloqueo por inactividad (solo actúa si hay bóveda y está desbloqueada).
            storage::lock::start_idle_watcher(app.handle().clone());
            app.manage(snippets::SnippetStore::load());
            // Túneles: definiciones guardadas + vigilante (arranque automático, reconexión, cierre).
            app.manage(tunnels::TunnelManager::load());
            app.state::<tunnels::TunnelManager>().start_watcher(app.handle().clone());
            // Arrastrar al sistema: borra lo preparado hace más de un día.
            dragout::clean_on_start(app.handle());
            // Servidor MCP para asistentes de IA (apagado por defecto).
            app.manage(mcp::McpState::new(app.handle()));
            mcp::on_app_start(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ssh
            ssh::commands::ssh_connect,
            ssh::commands::ssh_trust_host,
            ssh::commands::ssh_test_connection,
            ssh::commands::ssh_cancel_test,
            ssh::commands::ssh_disconnect,
            ssh::commands::ssh_list_sessions,
            ssh::commands::ssh_expect_reboot,
            // terminal
            terminal::commands::term_open,
            terminal::commands::term_write,
            terminal::commands::term_resize,
            terminal::commands::term_close,
            terminal::commands::term_tmux_list,
            terminal::commands::term_tmux_kill,
            // terminal local y asistentes de IA (Claude Code, Codex)
            localterm::commands::local_term_info,
            localterm::commands::local_term_open,
            localterm::commands::local_term_write,
            localterm::commands::local_term_resize,
            localterm::commands::local_term_close,
            localterm::commands::local_term_state,
            localterm::commands::local_ai_detect,
            localterm::commands::local_ai_ssh_aliases,
            localterm::commands::claude_vps_copy_session,
            localterm::commands::claude_vps_set_token,
            // sftp
            sftp::commands::sftp_home,
            sftp::commands::sftp_list_dir,
            sftp::commands::sftp_stat,
            sftp::commands::sftp_mkdir,
            sftp::commands::sftp_create_file,
            sftp::commands::sftp_rename,
            sftp::commands::sftp_delete,
            sftp::commands::sftp_chmod,
            sftp::commands::sftp_read_text,
            sftp::commands::sftp_write_text,
            // transfer
            transfer::commands::transfer_upload,
            transfer::commands::transfer_download,
            transfer::commands::transfer_list,
            transfer::commands::transfer_pause,
            transfer::commands::transfer_resume,
            transfer::commands::transfer_cancel,
            transfer::commands::transfer_retry,
            transfer::commands::transfer_clear_finished,
            transfer::commands::transfer_conflicts,
            transfer::commands::transfer_resolve_conflict,
            transfer::commands::transfer_batch_finished,
            // sincronizar carpeta (PC → servidor)
            foldersync::commands::folder_sync_preview,
            foldersync::commands::folder_sync_start,
            foldersync::commands::folder_sync_list,
            foldersync::commands::folder_sync_pause,
            foldersync::commands::folder_sync_remove,
            foldersync::commands::folder_sync_saved,
            foldersync::commands::folder_sync_forget,
            // arrastrar al escritorio / gestor de archivos
            dragout::commands::drag_out_dir,
            dragout::commands::drag_out_start,
            dragout::commands::drag_out_direct,
            // storage
            storage::commands::profiles_load,
            storage::commands::profiles_save_server,
            storage::commands::profiles_delete_server,
            storage::commands::profiles_save_project,
            storage::commands::profiles_delete_project,
            storage::commands::profiles_has_secret,
            storage::commands::profiles_reveal_secret,
            storage::commands::profiles_sudo_password,
            storage::commands::profiles_reveal_sudo_password,
            storage::commands::profiles_set_secret,
            storage::commands::db_creds_targets,
            storage::commands::db_creds_get,
            storage::commands::db_creds_set,
            storage::commands::settings_load,
            storage::commands::settings_save,
            storage::commands::profiles_duplicate_server,
            storage::commands::profiles_export_ssh_config,
            storage::commands::profiles_import_ssh_config,
            storage::ssh_config::commands::ssh_config_conflicts,
            storage::ssh_config::commands::ssh_config_alias_info,
            storage::ssh_config::commands::ssh_config_aliases,
            storage::ssh_config::commands::ssh_config_set_aliases,
            storage::ssh_config::commands::ssh_config_import_preview,
            // bóveda de contraseñas y bloqueo con PIN
            storage::commands::vault_status,
            storage::commands::vault_activity,
            storage::commands::vault_unlock,
            storage::commands::vault_lock,
            storage::commands::vault_enable,
            storage::commands::vault_disable,
            storage::commands::vault_change_pin,
            storage::commands::vault_reset,
            // archivos locales (exportar/importar)
            localfs::commands::local_write_text,
            localfs::commands::local_write_bytes,
            localfs::commands::local_read_text,
            // llaves SSH locales (asistente «Nuevo usuario con clave»)
            localkeys::commands::local_ssh_public_keys,
            localkeys::commands::local_ssh_generate_key,
            sshkeys::commands::local_ssh_private_keys,
            // biblioteca de comandos
            snippets::commands::snippets_load,
            snippets::commands::snippets_save,
            snippets::commands::snippets_delete,
            snippets::commands::exec_capture,
            snippets::commands::exec_capture_stdin,
            snippets::commands::exec_capture_stdin_live,
            snippets::commands::exec_capture_sudo,
            snippets::commands::exec_cancel,
            // cuenta de GitHub
            github::commands::gh_status,
            github::commands::gh_connect,
            github::commands::gh_disconnect,
            github::commands::gh_account,
            github::commands::gh_device_start,
            github::commands::gh_device_poll,
            github::commands::gh_my_keys,
            github::commands::gh_user_keys,
            github::commands::gh_add_key,
            github::commands::gh_local_pubkeys,
            github::commands::gh_read_pubkey,
            github::commands::gh_repos,
            github::commands::gh_branches,
            github::commands::gh_add_deploy_key,
            github::commands::gh_workflows,
            github::commands::gh_runs,
            github::commands::gh_dispatch,
            github::commands::gh_config_load,
            github::commands::gh_recipe_save,
            github::commands::gh_recipe_delete,
            github::commands::gh_recipe_mark,
            github::commands::gh_sync_find,
            github::commands::gh_sync_push,
            github::commands::gh_sync_pull,
            github::commands::gh_fetch_snippets,
            github::commands::gh_share_snippets,
            // túneles (port forwarding)
            tunnels::commands::tunnels_list,
            tunnels::commands::tunnels_save,
            tunnels::commands::tunnels_delete,
            tunnels::commands::tunnel_start,
            tunnels::commands::tunnel_stop,
            tunnels::commands::tunnels_status,
            tunnels::commands::tunnels_suggest_local_ports,
            // diagnóstico (Ajustes → Avanzado)
            diagnostics::commands::app_diagnostics,
            // asistentes de IA (MCP)
            mcp::commands::mcp_status,
            mcp::commands::mcp_set_enabled,
            mcp::commands::mcp_set_port,
            mcp::commands::mcp_set_approval_timeout,
            mcp::commands::mcp_set_sudo_password_request,
            mcp::commands::mcp_config,
            mcp::commands::mcp_set_access,
            mcp::commands::mcp_apply_rules,
            mcp::commands::mcp_set_protected_global,
            mcp::commands::mcp_forget_rule,
            mcp::commands::mcp_auto_list,
            mcp::commands::mcp_set_auto,
            mcp::commands::mcp_auto_off_all,
            mcp::commands::mcp_get_token,
            mcp::commands::mcp_regenerate_token,
            mcp::commands::mcp_client_config,
            mcp::commands::mcp_pending_approvals,
            mcp::commands::mcp_approval_reply,
            mcp::commands::mcp_ui_reply,
            mcp::commands::mcp_activity,
            mcp::commands::mcp_activity_clear,
            mcp::commands::mcp_activity_for_server,
            mcp::pairing::commands::mcp_pair_pending,
            mcp::pairing::commands::mcp_pair_reply,
            mcp::pairing::commands::mcp_paired_clients,
            mcp::pairing::commands::mcp_paired_set_access,
            mcp::pairing::commands::mcp_paired_revoke,
            // escáner de vulnerabilidades (Administración → Vulnerabilidades)
            vulnscan::commands::vulnscan_script,
            vulnscan::commands::vulnscan_plan,
            vulnscan::commands::vulnscan_parse_users,
            vulnscan::commands::vulnscan_parse_images,
            vulnscan::commands::vulnscan_analyze,
            vulnscan::commands::vulnscan_cancel,
            vulnscan::commands::vulnscan_history_list,
            vulnscan::commands::vulnscan_history_get,
            vulnscan::commands::vulnscan_latest,
            vulnscan::commands::vulnscan_history_delete,
            vulnscan::commands::vulnscan_set_ai,
            vulnscan::commands::vulnscan_export,
            vulnscan::commands::vulnscan_vuln_detail,
            vulnscan::commands::vulnscan_rescan_image,
            vulnscan::commands::vulnscan_recheck,
            // auditoría del servidor (Administración → Auditoría)
            audit::commands::audit_save,
            audit::commands::audit_history_list,
            audit::commands::audit_history_get,
            audit::commands::audit_latest,
            audit::commands::audit_history_delete,
            audit::commands::audit_set_ai,
            server_history::commands::server_history_append,
            server_history::commands::server_history_list,
            server_history::commands::server_history_clear,
            // asistente de IA opcional (solo explica informes)
            ai::commands::ai_status,
            ai::commands::ai_set_token,
            ai::commands::ai_test,
            ai::commands::ai_chat,
            ai::commands::ai_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar SSHorus");
}
