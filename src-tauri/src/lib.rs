//! Margin desktop shell. All storage access lives in [`vault`]; the command
//! contract is documented in `src/backend/tauri.ts` on the frontend side.

pub mod vault;

pub use vault::VaultState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(VaultState::default())
        .invoke_handler(tauri::generate_handler![
            vault::list_tree,
            vault::read_note,
            vault::write_note,
            vault::create_note,
            vault::create_folder,
            vault::search_vault,
            vault::rename_path,
            vault::delete_path,
            vault::watch_vault,
            vault::unwatch_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Margin");
}
