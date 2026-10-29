// Settings window (1000×700, normal title bar). It is created hidden at
// startup and never actually closes — hide instead so it can be reopened
// (close handling lives in main.rs).

use tauri::{AppHandle, Manager, Runtime};

pub const SETTINGS_LABEL: &str = "settings";

fn window<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::WebviewWindow<R>> {
    app.get_webview_window(SETTINGS_LABEL)
}

pub fn show<R: Runtime>(app: &AppHandle<R>) {
    let Some(win) = window(app) else { return };
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    let Some(win) = window(app) else { return };
    let _ = win.hide();
}
