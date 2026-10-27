// Shared app state: the one WS connection to the Python brain, the sidecar
// process handle, and the poll gate that wakes/parks the click-through cursor
// poller.

use std::process::Child;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Instant;

use tokio::sync::mpsc::UnboundedSender;

use crate::island::window::Rect;
/// Sleeps the cursor-poll thread when the island is hidden and wakes it when
/// anything may take the mouse. Also carries the click-through source of truth.
pub struct PollGate {
    active: Mutex<bool>,
    cv: Condvar,
    /// Island shape in window-logical coordinates, pushed by the front end.
    rect: Mutex<Rect>,
    /// Mirrors the window flag so the OS call only fires on change.
    ignoring: AtomicBool,
    /// Expanded (420 px panels) vs compact (120 px header) — informs idle timeout.
    pub expanded: AtomicBool,
    /// Python asked for click-through (dir "win" → set_ignore_cursor true).
    forced_ignore: AtomicBool,
    /// Last user contact (cursor on island, interaction). Drives idle collapse.
    pub last_activity: Mutex<Instant>,
}

impl PollGate {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(false),
            cv: Condvar::new(),
            rect: Mutex::new(Rect::default()),
            ignoring: AtomicBool::new(false),
            expanded: AtomicBool::new(false),
            forced_ignore: AtomicBool::new(false),
            last_activity: Mutex::new(Instant::now()),
        }
    }

    pub fn set_rect(&self, rect: Rect) {
        *self.rect.lock().unwrap() = rect;
    }

    pub fn rect(&self) -> Rect {
        *self.rect.lock().unwrap()
    }

    pub fn set_active(&self, on: bool) {
        let mut guard = self.active.lock().unwrap();
        *guard = on;
        self.cv.notify_all();
    }

    pub fn wait_until_active(&self) {
        let mut guard = self.active.lock().unwrap();
        while !*guard {
            guard = self.cv.wait(guard).unwrap();
        }
    }

    pub fn is_active(&self) -> bool {
        *self.active.lock().unwrap()
    }

    pub fn ignoring(&self) -> bool {
        self.ignoring.load(Ordering::Relaxed)
    }

    /// Records the applied flag so the next tick doesn't repeat the OS call.
    pub fn set_ignoring(&self, ignore: bool) {
        self.ignoring.store(ignore, Ordering::Relaxed);
    }

    pub fn expanded(&self) -> bool {
        self.expanded.load(Ordering::Relaxed)
    }

    pub fn set_forced_ignore(&self, on: bool) {
        self.forced_ignore.store(on, Ordering::Relaxed);
    }

    pub fn forced_ignore(&self) -> bool {
        self.forced_ignore.load(Ordering::Relaxed)
    }

    pub fn note_activity(&self) {
        *self.last_activity.lock().unwrap() = Instant::now();
    }

    pub fn idle_secs(&self) -> u64 {
        self.last_activity.lock().unwrap().elapsed().as_secs()
    }
}

pub struct AppState {
    pub gate: PollGate,
    /// Python's WS port, as read from %LOCALAPPDATA%\pico\state\server.json.
    pub port: Mutex<u16>,
    /// Frontend→Python write path (Some only while the socket is open).
    ws_sink: Mutex<Option<UnboundedSender<String>>>,
    /// The running pico-brain.exe / python server.py, if we spawned it.
    pub sidecar: Mutex<Option<Child>>,
    /// Bumped to force the WS loop to drop its connection and redial.
    generation: AtomicU64,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            gate: PollGate::new(),
            port: Mutex::new(0),
            ws_sink: Mutex::new(None),
            sidecar: Mutex::new(None),
            generation: AtomicU64::new(0),
        }
    }

    /// Send a protocol frame to Python. Frames are JSON text; the caller
    /// serializes so the front end and hotkeys share one path.
    pub fn send_ws(&self, json: &str) -> Result<(), String> {
        let sink = self.ws_sink.lock().unwrap().clone();
        match sink {
            Some(tx) => tx.send(json.to_string()).map_err(|e| e.to_string()),
            // Not an error: the brain may be down; callers queue by retrying.
            None => Err("python link not connected".to_string()),
        }
    }

    pub fn send_ws_lossy(&self, json: &str) {
        let _ = self.send_ws(json);
    }

    pub fn set_ws_sink(&self, sink: UnboundedSender<String>) {
        *self.ws_sink.lock().unwrap() = Some(sink);
    }

    pub fn clear_ws_sink(&self) {
        *self.ws_sink.lock().unwrap() = None;
    }

    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Relaxed)
    }

    pub fn request_reconnect(&self) {
        self.generation.fetch_add(1, Ordering::Relaxed);
    }
}
