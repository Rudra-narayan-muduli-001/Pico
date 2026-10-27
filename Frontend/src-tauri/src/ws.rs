// The one WebSocket to the Python brain (plip pattern):
//   read %LOCALAPPDATA%\pico\state\server.json for the port → connect
//   ws://127.0.0.1:<port>/ws → route frames: dir "ui" → island/settings
//   webviews, dir "win" → window ops. Frontend/hotkey frames leave through a
//   single mpsc sink. Reconnects automatically, respawns the sidecar if it died.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::time::sleep;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use crate::island::{self, ISLAND_LABEL};
use crate::settings::window::SETTINGS_LABEL;
use crate::sidecar;
use crate::state::AppState;

pub fn spawn(app: AppHandle, state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move { run(app, state).await });
}

async fn run(app: AppHandle, state: Arc<AppState>) {
    // Wait for the sidecar to publish its port file before the first dial.
    // If it never appears, show the island anyway at 15 s: the front end then
    // renders its "Brain offline — retrying" pill and pokes pico_reconnect
    // every 5 s. The UI never depends on the brain being up.
    let offline_deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    let mut shown = false;
    loop {
        if let Some(p) = sidecar::read_port() {
            *state.port.lock().unwrap() = p;
            break;
        }
        if !shown && tokio::time::Instant::now() >= offline_deadline {
            shown = true;
            island::window::island_ready(&app, &state.gate);
        }
        sleep(Duration::from_millis(500)).await;
    }

    let mut generation = state.generation();
    loop {
        // The port file may have been rewritten by a restarted sidecar.
        let port = sidecar::read_port().unwrap_or(*state.port.lock().unwrap());
        *state.port.lock().unwrap() = port;
        let url = format!("ws://127.0.0.1:{port}/ws");

        match connect_async(&url).await {
            Ok((socket, _)) => {
                let (mut write, mut read) = socket.split();
                let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
                state.set_ws_sink(tx);
                emit_status(&app, true);
                if !shown {
                    shown = true;
                    island::window::island_ready(&app, &state.gate);
                }
                'conn: loop {
                    if state.generation() != generation {
                        generation = state.generation();
                        break 'conn; // reconnect was explicitly requested
                    }
                    tokio::select! {
                        outbound = rx.recv() => match outbound {
                            Some(text) => {
                                if write.send(Message::Text(text.into())).await.is_err() {
                                    break 'conn;
                                }
                            }
                            None => break 'conn,
                        },
                        inbound = read.next() => match inbound {
                            Some(Ok(Message::Text(text))) => route(&app, &text),
                            Some(Ok(_)) => {}
                            Some(Err(_)) | None => break 'conn,
                        },
                    }
                }
                state.clear_ws_sink();
                emit_status(&app, false);
            }
            Err(_) => {}
        }

        // If the python child died, bring it back (PRD: auto-restart sidecar).
        sidecar::ensure_running(&app, &state);
        sleep(Duration::from_secs(2)).await;
    }
}

fn emit_status(app: &AppHandle, connected: bool) {
    // pico-status: cheap health for any surface; pico-ui link frames follow
    // the Design.md dir:"ui" contract so the island can show key status.
    let _ = app.emit("pico-status", if connected { "connected" } else { "disconnected" });
    let frame = json!({ "dir": "ui", "type": "link", "connected": connected });
    let _ = app.emit_to(ISLAND_LABEL, "pico-ui", frame.clone());
    let _ = app.emit_to(SETTINGS_LABEL, "pico-ui", frame);
}

fn route(app: &AppHandle, text: &str) {
    let Ok(v) = serde_json::from_str::<Value>(text) else { return };
    match v.get("dir").and_then(|d| d.as_str()) {
        // Python → UI: every window receives it; each surface filters the
        // frame types it cares about.
        Some("ui") => {
            let _ = app.emit("pico-ui", v);
        }
        // Python → window ops, off the WS reader thread.
        Some("win") => {
            let app2 = app.clone();
            let v = v.clone();
            let _ = app.run_on_main_thread(move || island::apply_win_op(&app2, &v));
        }
        _ => {}
    }
}
