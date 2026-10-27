// Notification-area icon (Design.md): Show Island / Open Settings / Quit.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;

use crate::island::window;
use crate::settings;

pub fn build<R: tauri::Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Island", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Open Settings", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &settings_item, &sep, &quit])?;

    let mut builder = TrayIconBuilder::with_id("pico")
        .tooltip("Pico")
        .menu(&menu)
        .on_menu_event(|app: &AppHandle<R>, event| match event.id.as_ref() {
            "show" => window::island_show(app),
            "settings" => settings::window::show(app),
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}
