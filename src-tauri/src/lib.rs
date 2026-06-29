mod agent;
mod vault;

use vault::Vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Vault::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault::jmap_unlock,
            vault::jmap_login,
            vault::jmap_request,
            vault::jmap_download,
            vault::jmap_download_save,
            vault::jmap_upload,
            vault::jmap_logout,
            vault::jmap_forget,
            vault::accounts_list,
            vault::account_authenticate,
            vault::account_session,
            vault::account_add,
            vault::account_remove,
            vault::open_external,
            agent::claude_message,
            agent::claude_message_stream,
            agent::claude_auth_status,
            agent::claude_login_start,
            agent::claude_login_finish,
            agent::claude_logout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
