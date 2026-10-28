// dir:"win" window-op frames (Design.md "Window Ops"). Both directions land
// here: Python → Tauri over the WS (ws.rs), and UI → Tauri when a surface
// invokes pico_send_ws with a frame whose dir is "win" (main.rs routes it here
// instead of forwarding it to Python).

use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

use crate::island::{overlay, window};
use crate::settings;

pub fn apply_win_op<R: Runtime>(app: &AppHandle<R>, msg: &Value) {
    let Some(op) = msg.get("op").and_then(|o| o.as_str()) else { return };
    match op {
        "set_ignore_cursor" => {
            let value = msg.get("value").and_then(|v| v.as_bool()).unwrap_or(false);
            let state = app.state::<std::sync::Arc<crate::state::AppState>>();
            state.gate.set_forced_ignore(value);
            if value {
                if let Some(win) = window::window(app) {
                    let _ = win.set_ignore_cursor_events(true);
                }
                state.gate.set_ignoring(true);
            }
            // value=false: the cursor poll re-takes the mouse on its next tick.
        }
        "island_show" => window::island_show(app),
        "island_hide" => window::island_hide(app),
        "settings_show" => settings::window::show(app),
        "settings_hide" => settings::window::hide(app),
        "circle_show" => overlay::show(app),
        "circle_hide" => overlay::hide(app),
        _ => {}
    }
}

/// True when a UI-originated frame is a window op rather than a brain frame.
pub fn is_win_frame(v: &Value) -> bool {
    v.get("dir").and_then(|d| d.as_str()) == Some("win")
}
