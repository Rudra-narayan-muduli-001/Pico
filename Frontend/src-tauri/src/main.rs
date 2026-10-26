// Pico — app entry. No console window in release; the island is the UI.
//
// Wiring (Design.md "Tauri Rust Module Structure"):
//   sidecar::spawn  → python brain writes %LOCALAPPDATA%\pico\state\server.json
//   ws::spawn       → one WS to ws://127.0.0.1:<port>/ws, both directions
//   hotkeys+overlay → PTT / dictation / circle, global, even with island hidden
//   island::window  → notch placement + shape-accurate click-through

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hotkeys;
mod island;
mod keyring;
mod platform;
mod settings;
mod sidecar;
mod state;
mod tray;
mod ws;

use std::sync::atomic::Ordering;
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use state::AppState;

// NOTE on WebView2: one browser environment per process, fixed by the first
// window created. Every window must carry the SAME additionalBrowserArgs (see
// tauri.conf.json, identical on all three) or later windows come up blank.

fn state_dir() -> std::path::PathBuf {
    sidecar::state_dir()
}

// ── Settings (non-secret, %LOCALAPPDATA%\pico\state\*.json) ───────────────────

/// Free-form JSON owned by the settings UI; Rust just persists it.
#[tauri::command]
fn settings_load() -> Value {
    std::fs::read_to_string(state_dir().join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}))
}

#[tauri::command]
fn settings_save(app: AppHandle, settings: Value) -> Result<(), String> {
    let dir = state_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("settings.json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join("settings.json")).map_err(|e| e.to_string())?;
    // island/other surfaces re-render from the new truth.
    let _ = app.emit("settings-changed", settings);
    Ok(())
}

/// Loadout is also a brain concern: persist it, then forward over WS per
/// Design.md ({"dir":"py","cmd":"save_loadout"}).
#[tauri::command]
fn save_loadout(app: AppHandle, state: State<Arc<AppState>>, loadout: Value) -> Result<(), String> {
    let dir = state_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(
        dir.join("loadout.json"),
        serde_json::to_string_pretty(&loadout).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    state.send_ws_lossy(&json!({ "dir": "py", "cmd": "save_loadout", "loadout": loadout }).to_string());
    let _ = app.emit("loadout-changed", loadout);
    Ok(())
}

// ── WS bridge ─────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_server_port(state: State<Arc<AppState>>) -> u16 {
    *state.port.lock().unwrap()
}

/// The ONLY write path from any surface to the backend. Frames with dir:"win"
/// are window ops executed locally; everything else goes to the Python brain.
#[tauri::command]
fn pico_send_ws(app: AppHandle, state: State<Arc<AppState>>, json: String) -> Result<(), String> {
    if let Ok(v) = serde_json::from_str::<Value>(&json) {
        if island::ipc::is_win_frame(&v) {
            island::ipc::apply_win_op(&app, &v);
            return Ok(());
        }
    }
    state.send_ws(&json)
}

/// Settings/island "Reconnect": drop the WS connection and redial.
#[tauri::command]
fn pico_reconnect(state: State<Arc<AppState>>) {
    state.request_reconnect();
}

// ── Autostart ─────────────────────────────────────────────────────────────────

#[tauri::command]
fn autostart_get(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn autostart_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let m = app.autolaunch();
    (if enabled { m.enable() } else { m.disable() }).map_err(|e| e.to_string())
}

// ── Island window front-end contract ─────────────────────────────────────────

/// The front end pushed the island's drawn shape (compact 120 px or expanded
/// 420 px). Only that shape takes the mouse; everything else is click-through.
#[tauri::command]
fn set_island_shape(state: State<Arc<AppState>>, x: f64, y: f64, width: f64, height: f64) {
    state.gate.set_rect(island::window::Rect { x, y, w: width, h: height });
    state.gate.expanded.store(height > 200.0, Ordering::Relaxed);
    state.gate.note_activity();
}

/// A text field in the island wants real keyboard focus: WS_EX_NOACTIVATE has
/// to go first, and comes back on blur or the island keeps focus forever.
#[tauri::command]
fn focus_window(app: AppHandle, focused: bool) {
    island::window::focus_window(&app, focused);
}

// ── Misc ──────────────────────────────────────────────────────────────────────

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn open_settings_window(app: AppHandle) {
    settings::window::show(&app);
}

/// The circle page finished its lasso + question and can go back to sleep.
#[tauri::command]
fn circle_hide(app: AppHandle) {
    island::overlay::hide(&app);
}

fn main() {
    let app_state = Arc::new(AppState::new());

    tauri::Builder::default()
        // Second launch: just surface the island again.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            island::window::island_show(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(hotkeys::plugin())
        .manage(app_state.clone())
        .invoke_handler(tauri::generate_handler![
            settings_load,
            settings_save,
            save_loadout,
            get_server_port,
            pico_send_ws,
            pico_reconnect,
            keyring::save_key,
            keyring::load_key,
            keyring::delete_key,
            keyring::key_present,
            autostart_get,
            autostart_set,
            set_island_shape,
            focus_window,
            app_version,
            open_settings_window,
            circle_hide,
        ])
        .setup(move |app| {
            let handle = app.handle();
            tray::build(handle)?;
            // All three windows exist from the config at startup (hidden) — on
            // WebView2 a window created later can come up blank. Settings must
            // never actually close: hide instead so it can be reopened.
            if let Some(win) = app.get_webview_window(settings::window::SETTINGS_LABEL) {
                let w = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }
            if let Some(win) = app.get_webview_window(island::CIRCLE_LABEL) {
                let w = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let app = w.app_handle().clone();
                        island::overlay::hide(&app);
                    }
                });
            }
            island::window::prepare(handle);
            island::overlay::prepare(handle);
            // Brain first, link second: ws.rs waits on the port file anyway.
            sidecar::spawn(handle, &app_state);
            ws::spawn(handle.clone(), app_state.clone());
            island::window::spawn_cursor_poll(handle.clone(), app_state.clone());
            hotkeys::register(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Pico")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                sidecar::kill(app);
            }
        });
}
