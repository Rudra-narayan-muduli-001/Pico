// Circle-to-ask fullscreen overlay (Design.md "Circle-to-Ask Overlay"):
// transparent window, click-through OFF while the lasso gesture is live,
// hide + reset the page whenever it leaves the screen.

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::platform;

pub const CIRCLE_LABEL: &str = "circle";

fn window<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::WebviewWindow<R>> {
    app.get_webview_window(CIRCLE_LABEL)
}

/// Startup hygiene: the overlay must not steal focus when it appears.
pub fn prepare<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = window(app) {
        platform::make_non_activating(&win);
        let _ = win.set_ignore_cursor_events(true);
    }
}

pub fn visible<R: Runtime>(app: &AppHandle<R>) -> bool {
    window(app).map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false)
}

pub fn show<R: Runtime>(app: &AppHandle<R>) {
    let Some(win) = window(app) else { return };
    // Fullscreen transparent overlay must take the mouse while drawing.
    let _ = win.set_ignore_cursor_events(false);
    let _ = win.show();
    // `circle_mode` tells the page a fresh gesture is starting (drop old path).
    let _ = app.emit_to(CIRCLE_LABEL, "circle_mode", json!({ "active": true }));
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    let Some(win) = window(app) else { return };
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.hide();
    let _ = app.emit_to(CIRCLE_LABEL, "circle_mode", json!({ "active": false }));
    // Tell the page to drop any in-progress lasso path.
    let _ = app.emit_to(CIRCLE_LABEL, "circle-reset", ());
}


