// Python sidecar lifecycle (plip pattern):
//   spawn pico-brain.exe / python server.py → it writes
//   %LOCALAPPDATA%\pico\state\server.json with {"port": N} → ws.rs dials it.
//   Kill on exit via taskkill /T so anything python spawned comes down too.

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::state::AppState;

/// Where python publishes its port.
pub fn state_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
    std::path::Path::new(&base).join("pico").join("state")
}

pub fn read_port() -> Option<u16> {
    let raw = std::fs::read_to_string(state_dir().join("server.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("port")?.as_u64().and_then(|p| u16::try_from(p).ok())
}

/// `python`/`pico-brain.exe` must not pop a console window from a GUI app.
#[cfg(windows)]
fn no_console(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000) // CREATE_NO_WINDOW
}

/// The command that starts the brain, in priority order:
///   1. %PICO_BRAIN% (path to an exe — test/dev override),
///   2. pico-brain.exe next to the Pico exe (installed, PyInstaller build),
///   3. dev only: the repo's pico-python/server.py under `python` on PATH
///      (found by walking up from the exe — debug builds run from target/).
fn sidecar_command() -> Option<Command> {
    if let Ok(path) = std::env::var("PICO_BRAIN") {
        let p = PathBuf::from(&path);
        if p.is_file() {
            return Some(Command::new(p));
        }
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;

    let bundled = dir.join("pico-brain.exe");
    if bundled.is_file() {
        return Some(Command::new(bundled));
    }

    #[cfg(debug_assertions)]
    for anc in dir.ancestors() {
        let py = anc.join("pico-python").join("server.py");
        if py.is_file() {
            let mut cmd = Command::new("python");
            cmd.arg(&py).current_dir(anc.join("pico-python"));
            return Some(cmd);
        }
    }
    None
}

/// Spawn the sidecar once (no-op if one is already tracked as running).
pub fn spawn<R: tauri::Runtime>(_app: &AppHandle<R>, state: &Arc<AppState>) {
    let mut guard = state.sidecar.lock().unwrap();
    if guard.is_some() {
        return;
    }
    let Some(mut cmd) = sidecar_command() else {
        // Fine for UI-only development: ws.rs just never connects.
        eprintln!("[pico] no python sidecar found (set PICO_BRAIN, or place pico-brain.exe next to the exe)");
        return;
    };
    #[cfg(windows)]
    no_console(&mut cmd);
    // Own stdin as a pipe: python treats stdin EOF as "shell is gone" and
    // exits. An *inherited* stdin from a GUI process can be an invalid handle
    // that reads EOF instantly, so keep the pipe open for the child's whole
    // life (the Child we hold in `state.sidecar` owns the write end).
    cmd.stdin(Stdio::piped());
    match cmd.spawn() {
        Ok(child) => {
            eprintln!("[pico] sidecar started (pid {})", child.id());
            *guard = Some(child);
        }
        Err(e) => eprintln!("[pico] sidecar failed to start: {e}"),
    }
}

/// If the child we spawned has exited, drop the handle and respawn it on the
/// next WS redial tick.
pub fn ensure_running<R: tauri::Runtime>(app: &AppHandle<R>, state: &Arc<AppState>) {
    let died = {
        let mut guard = state.sidecar.lock().unwrap();
        match guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(_)) => {
                    *guard = None;
                    true
                }
                Ok(None) => false,
                Err(_) => false,
            },
            // Never spawned (nothing found): don't keep retrying every tick.
            None => false,
        }
    };
    if died {
        eprintln!("[pico] sidecar exited — respawning");
        spawn(app, state);
    }
}

/// Kill the sidecar *tree* on exit (taskkill /T catches grandchildren python
/// may have spawned; RunEvent::Exit alone leaves orphans).
pub fn kill<R: tauri::Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<Arc<AppState>>().map(|s| s.inner().clone()) else { return };
    let child = state.sidecar.lock().unwrap().take();
    if let Some(child) = child {
        let mut tk = Command::new("taskkill");
        tk.args(["/PID", &child.id().to_string(), "/T", "/F"]);
        #[cfg(windows)]
        no_console(&mut tk);
        let _ = tk.output();
    }
}
