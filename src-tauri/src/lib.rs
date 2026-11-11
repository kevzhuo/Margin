//! Margin desktop shell. All storage access lives in [`vault`]; the command
//! contract is documented in `src/backend/tauri.ts` on the frontend side.

pub mod menu;
pub mod vault;

use std::time::Duration;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;
pub use vault::VaultState;

/// If the frontend never reports that it has painted (a crash, a blank page),
/// show the window anyway after this long so the app is never invisible.
const SHOW_FALLBACK: Duration = Duration::from_secs(4);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            // Restore size, position and maximized state, but not visibility:
            // the frontend shows the window once it has painted.
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .manage(VaultState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_FALLBACK);
                if let Some(window) = handle.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                }
            });
            Ok(())
        });

    // The native menu bar is a macOS convention; other platforms keep the
    // app's own chrome.
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(menu::build)
        .on_menu_event(menu::forward_to_frontend);

    builder
        .invoke_handler(tauri::generate_handler![
            vault::list_tree,
            vault::read_note,
            vault::write_note,
            vault::create_note,
            vault::create_folder,
            vault::search_vault,
            vault::list_images,
            vault::rename_path,
            vault::delete_path,
            vault::watch_vault,
            vault::unwatch_vault,
            vault::save_attachment,
            vault::create_vault,
            menu::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Margin");
}
