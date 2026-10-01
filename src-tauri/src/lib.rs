mod alerts;
mod ics_open;
mod push;
mod vault;

use tauri::Manager;

use vault::Vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch (e.g. double-clicking an
        // .ics while the app is open) forwards its argv here and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            ics_open::handle_args(app, &argv, std::path::Path::new(&cwd));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(Vault::default())
        .manage(push::Push::default())
        .manage(ics_open::PendingIcs::default())
        .setup(|app| {
            let args: Vec<String> = std::env::args().skip(1).collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            ics_open::handle_args(app.handle(), &args, &cwd);
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
            push::push_start,
            push::push_stop,
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
            vault::reveal_item,
            ics_open::take_pending_ics,
            alerts::notify_desktop,
            alerts::ntfy_publish,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
