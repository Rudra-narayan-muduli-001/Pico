// Global hotkeys (Design.md / task spec):
//
//   Ctrl+Space        Talk — hold = PTT:  press → {dir:"py",cmd:"ptt_start"},
//                                          release → ptt_stop
//   Ctrl+Shift+Space  Dictate — hold:     press → dictation_start, release → dictation_stop
//   Ctrl+Shift+Q      Circle — press toggles the lasso overlay (+ circle_mode event)
//   Escape            Cancels the circle overlay when it's up
//
// Trust note: ShortcutState::Released is best-effort on Windows (the
// underlying RegisterHotKey API is press-only; the plugin reports release
// where the platform can). The Python side must treat ptt/dictation as
// self-limiting even if the stop frame never arrives.

use std::str::FromStr;
use std::sync::OnceLock;

use serde_json::json;
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcut, Shortcut, ShortcutState};

use crate::island::overlay;
use crate::state::AppState;

fn table() -> &'static [(Shortcut, &'static str)] {
    static TABLE: OnceLock<Vec<(Shortcut, &'static str)>> = OnceLock::new();
    TABLE.get_or_init(|| {
        [
            ("Ctrl+Space", "talk"),
            ("Ctrl+Shift+Space", "dictate"),
            ("Ctrl+Shift+Q", "circle"),
            ("Escape", "escape"),
        ]
        .iter()
        .filter_map(|(keys, id)| match Shortcut::from_str(keys) {
            Ok(s) => Some((s, *id)),
            Err(e) => {
                eprintln!("[pico] could not parse shortcut {keys}: {e}");
                None
            }
        })
        .collect()
    })
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            let Some((_, id)) = table().iter().find(|(s, _)| s == shortcut) else { return };
            dispatch(app, id, event.state);
        })
        .build()
}

fn dispatch<R: Runtime>(app: &AppHandle<R>, action: &str, state: ShortcutState) {
    let pressed = state == ShortcutState::Pressed;
    let app_state = app.try_state::<std::sync::Arc<AppState>>().map(|s| s.inner().clone());
    match (action, pressed) {
        ("talk", true) => app_state.iter().for_each(|s| {
            s.gate.note_activity();
            s.send_ws_lossy(&json!({ "dir": "py", "cmd": "ptt_start" }).to_string())
        }),
        ("talk", false) => app_state.iter().for_each(|s| {
            s.send_ws_lossy(&json!({ "dir": "py", "cmd": "ptt_stop" }).to_string())
        }),
        ("dictate", true) => app_state.iter().for_each(|s| {
            s.gate.note_activity();
            s.send_ws_lossy(&json!({ "dir": "py", "cmd": "dictation_start" }).to_string())
        }),
        ("dictate", false) => app_state.iter().for_each(|s| {
            s.send_ws_lossy(&json!({ "dir": "py", "cmd": "dictation_stop" }).to_string())
        }),
        ("circle", true) => {
            if overlay::visible(app) {
                cancel_circle(app);
            } else {
                overlay::show(app); // also emits circle_mode {active:true}
            }
        }
        ("escape", true) => {
            if overlay::visible(app) {
                cancel_circle(app);
            }
        }
        _ => {}
    }
}

/// Esc / re-press: tell the brain the question is off, drop the overlay.
fn cancel_circle<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<std::sync::Arc<AppState>>() {
        state.send_ws_lossy(&json!({ "dir": "py", "cmd": "circle_cancel" }).to_string());
    }
    overlay::hide(app);
}

/// Ctrl+Shift+Q is a toggle; Escape cancels (see dispatch).
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    let Some(gs) = app.try_state::<GlobalShortcut<R>>() else { return };
    for (shortcut, id) in table() {
        if let Err(e) = gs.register(*shortcut) {
            eprintln!("[pico] could not register {id} ({shortcut}): {e}");
        }
    }
}
