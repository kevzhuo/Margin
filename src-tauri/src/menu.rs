//! The macOS menu bar. Custom items forward their id to the frontend as a
//! `menu://command` event; the frontend runs the matching command from its
//! registry (see `src/state/menuBridge.ts`). Standard items (Cut, Copy, Paste,
//! Undo, Hide, Quit, ...) are native, so they behave exactly like other Mac apps.

use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

/// Event the frontend listens for.
pub const MENU_EVENT: &str = "menu://command";

/// A custom menu item: (id, label, accelerator).
pub type Item = (&'static str, &'static str, Option<&'static str>);

pub const FILE: &[Item] = &[
    ("note.new", "New Note", Some("CmdOrCtrl+N")),
    ("folder.new", "New Folder", Some("Shift+CmdOrCtrl+N")),
    ("vault.open", "Open Vault…", Some("Shift+CmdOrCtrl+O")),
    ("note.rename", "Rename Note", Some("F2")),
    ("note.reveal", "Show in Finder", Some("Alt+CmdOrCtrl+R")),
    ("note.copyPath", "Copy Note Path", None),
    ("note.delete", "Move Note to Trash", None),
];

pub const FIND: &[Item] = &[
    ("search.note", "Find…", Some("CmdOrCtrl+F")),
    (
        "search.vault",
        "Search All Notes…",
        Some("Shift+CmdOrCtrl+F"),
    ),
];

pub const VIEW: &[Item] = &[
    (
        "view.sidebar",
        "Toggle Sidebar",
        Some("CmdOrCtrl+Backslash"),
    ),
    (
        "view.outline",
        "Toggle Outline",
        Some("Shift+CmdOrCtrl+Backslash"),
    ),
    ("view.fullWidth", "Toggle Full Width", None),
    ("view.focus", "Focus Mode", Some("F8")),
    ("view.typewriter", "Typewriter Mode", Some("F9")),
];

pub const ZOOM: &[Item] = &[
    ("text.bigger", "Make Text Bigger", Some("CmdOrCtrl+Equal")),
    ("text.smaller", "Make Text Smaller", Some("CmdOrCtrl+Minus")),
    ("text.reset", "Actual Size", None),
];

pub const THEME: &[Item] = &[
    ("theme.system", "Match System", None),
    ("theme.light", "Light", None),
    ("theme.dark", "Dark", None),
];

pub const GO: &[Item] = &[
    ("nav.back", "Back", Some("CmdOrCtrl+BracketLeft")),
    ("nav.forward", "Forward", Some("CmdOrCtrl+BracketRight")),
    ("palette.open", "Go to Note…", Some("CmdOrCtrl+P")),
    (
        "palette.commands",
        "Command Palette…",
        Some("Shift+CmdOrCtrl+P"),
    ),
];

pub const FORMAT: &[Item] = &[
    ("format.bold", "Bold", Some("CmdOrCtrl+B")),
    ("format.italic", "Italic", Some("CmdOrCtrl+I")),
    ("format.strike", "Strikethrough", Some("Shift+CmdOrCtrl+X")),
    ("format.code", "Inline Code", Some("CmdOrCtrl+E")),
    ("format.link", "Link", Some("CmdOrCtrl+K")),
];

pub const BLOCKS: &[Item] = &[
    ("format.h1", "Heading 1", Some("CmdOrCtrl+1")),
    ("format.h2", "Heading 2", Some("CmdOrCtrl+2")),
    ("format.h3", "Heading 3", Some("CmdOrCtrl+3")),
    ("format.paragraph", "Body Text", Some("CmdOrCtrl+0")),
    ("format.task", "Toggle Task", Some("CmdOrCtrl+Enter")),
    ("format.quote", "Quote", Some("Shift+CmdOrCtrl+Period")),
];

pub const APP: &[Item] = &[("settings.open", "Settings…", Some("CmdOrCtrl+Comma"))];

pub const HELP: &[Item] = &[(
    "help.shortcuts",
    "Keyboard Shortcuts",
    Some("Shift+CmdOrCtrl+Slash"),
)];

/// Every custom item, for tests and for the frontend contract.
pub fn all_items() -> impl Iterator<Item = &'static Item> {
    [APP, FILE, FIND, VIEW, ZOOM, THEME, GO, FORMAT, BLOCKS, HELP]
        .into_iter()
        .flatten()
}

fn add<'m, R: Runtime>(
    mut submenu: SubmenuBuilder<'m, R, AppHandle<R>>,
    app: &'m AppHandle<R>,
    items: &[Item],
) -> tauri::Result<SubmenuBuilder<'m, R, AppHandle<R>>> {
    for (id, label, accel) in items {
        let mut item = MenuItemBuilder::with_id(*id, *label);
        if let Some(accel) = accel {
            item = item.accelerator(*accel);
        }
        submenu = submenu.item(&item.build(app)?);
    }
    Ok(submenu)
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = AboutMetadata {
        name: Some("Margin".into()),
        version: Some(app.package_info().version.to_string()),
        comments: Some("A local Markdown editor.".into()),
        ..Default::default()
    };

    let app_menu = SubmenuBuilder::new(app, "Margin")
        .about(Some(about))
        .separator();
    let app_menu = add(app_menu, app, APP)?
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file = add(SubmenuBuilder::new(app, "File"), app, FILE)?
        .separator()
        .close_window()
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator();
    let edit = add(edit, app, FIND)?.build()?;

    let theme = add(SubmenuBuilder::new(app, "Appearance"), app, THEME)?.build()?;
    let view = add(SubmenuBuilder::new(app, "View"), app, VIEW)?.separator();
    let view = add(view, app, ZOOM)?
        .separator()
        .item(&theme)
        .separator()
        .fullscreen()
        .build()?;

    let go = add(SubmenuBuilder::new(app, "Go"), app, GO)?.build()?;

    let format = add(SubmenuBuilder::new(app, "Format"), app, FORMAT)?.separator();
    let format = add(format, app, BLOCKS)?.build()?;

    let window = SubmenuBuilder::with_id(app, tauri::menu::WINDOW_SUBMENU_ID, "Window")
        .minimize()
        .maximize()
        .separator()
        .bring_all_to_front()
        .build()?;

    let help = add(
        SubmenuBuilder::with_id(app, tauri::menu::HELP_SUBMENU_ID, "Help"),
        app,
        HELP,
    )?
    .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &go, &format, &window, &help])
        .build()
}

/// Send a custom item's id to the frontend; native items handle themselves.
pub fn forward_to_frontend<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().0.as_str();
    if all_items().any(|(item, _, _)| *item == id) {
        let _ = app.emit(MENU_EVENT, id.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::str::FromStr;

    #[test]
    fn ids_are_unique() {
        let mut seen = HashSet::new();
        for (id, _, _) in all_items() {
            assert!(seen.insert(*id), "duplicate menu id {id}");
        }
    }

    #[test]
    fn accelerators_parse() {
        for (id, _, accel) in all_items() {
            if let Some(accel) = accel {
                assert!(
                    muda::accelerator::Accelerator::from_str(accel).is_ok(),
                    "{id}: invalid accelerator {accel}"
                );
            }
        }
    }

    #[test]
    fn shortcuts_do_not_collide() {
        let mut seen = HashSet::new();
        for (id, _, accel) in all_items() {
            if let Some(accel) = accel {
                assert!(seen.insert(*accel), "{id}: {accel} is used twice");
            }
        }
    }
}
