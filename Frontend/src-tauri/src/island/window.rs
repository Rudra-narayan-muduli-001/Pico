// Island window: the notch at the top of the primary monitor, plus the
// click-through cursor poll that keeps it from swallowing clicks outside its
// drawn shape.
//
// Why a poll and not naive `set_ignore_cursor_events(true)` while compact:
// a click-through webview can never receive the hover that would turn
// click-through back OFF, so a compact island that ignores the cursor could
// never be clicked to expand. The poll hit-tests the cursor against the shape
// the front end reports (set_island_shape) at ~60 Hz and flips the OS flag
// only on change — pixel-accurate AND still clickable. The window itself stays
// a fixed 760×420 (Design.md panel size); "compact" is a 120 px drawn shape,
// expansion is CSS — no window resize means no flicker or DPI re-layout.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

use crate::platform;
use crate::state::PollGate;

pub const ISLAND_LABEL: &str = "island";

/// Fixed island window size (Design.md): 760×420 expanded, 120 px compact is a
/// front-end shape inside it — the *window* never resizes, click-through does.
pub const PANEL_W: f64 = 760.0;
pub const PANEL_H: f64 = 420.0;

/// Margin around the reported island shape that still counts as "on it", in
/// logical px. Wide enough that a fast-moving cursor lands on buttons.
const HIT_MARGIN: f64 = 14.0;

/// Expanded island goes click-through (and the front end collapses) after this
/// much keyboard+mouse silence.
const IDLE_COLLAPSE_SECS: u64 = 30;

#[derive(Clone, Copy, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize, Clone)]
pub struct CursorPayload {
    pub x: f64,
    pub y: f64,
}

pub fn window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(ISLAND_LABEL)
}

// ── Placement ─────────────────────────────────────────────────────────────────

/// Top-center of the primary monitor (Design.md v1: primary only; the monitor
/// selector from Settings lands in a later phase — coucou's pick_display logic
/// is the upgrade path).
pub fn apply_geometry<R: Runtime>(app: &AppHandle<R>) {
    let Some(win) = window(app) else { return };
    let Some(m) = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| app.available_monitors().ok().and_then(|ms| ms.into_iter().next()))
    else {
        return;
    };
    let scale = m.scale_factor();
    let mp = *m.position();
    let ms = *m.size();
    let pw = (PANEL_W * scale).round().max(1.0) as u32;
    let ph = (PANEL_H * scale).round().max(1.0) as u32;
    let x = mp.x + (ms.width as i32 - pw as i32) / 2;
    let y = mp.y;
    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    // Moving across displays can rescale the window: re-assert physical size.
    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_always_on_top(true);
}

pub fn island_show<R: Runtime>(app: &AppHandle<R>) {
    let Some(win) = window(app) else { return };
    apply_geometry(app);
    let _ = win.show();
}

pub fn island_hide<R: Runtime>(app: &AppHandle<R>) {
    let Some(win) = window(app) else { return };
    let _ = win.hide();
}

/// First WS connect: place + reveal the island, start taking the mouse.
pub fn island_ready<R: Runtime>(app: &AppHandle<R>, gate: &PollGate) {
    island_show(app);
    gate.set_active(true);
}

/// Startup window hygiene that doesn't fit in the config file.
pub fn prepare<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = window(app) {
        platform::make_non_activating(&win);
        // Nothing drawn yet → nothing takes the mouse until the front end
        // reports the island shape via set_island_shape.
        let _ = win.set_ignore_cursor_events(true);
    }
}

/// A text field in the island wants real keyboard focus: WS_EX_NOACTIVATE has
/// to go first, and comes back on blur or the island keeps focus forever.
pub fn focus_window<R: Runtime>(app: &AppHandle<R>, focused: bool) {
    let Some(win) = window(app) else { return };
    platform::set_activating(&win, focused);
    if focused {
        let _ = win.set_focus();
    }
}

// ── Click-through cursor poll ─────────────────────────────────────────────────

/// ~60 Hz: read the cursor, flip WS_EX_TRANSPARENT so only the island's drawn
/// shape takes the mouse, and push `cursor` (window-logical) to the front end.
/// Parked on a condvar while the island is hidden so it costs nothing.
pub fn spawn_cursor_poll<R: Runtime + 'static>(
    app: AppHandle<R>,
    state: Arc<crate::state::AppState>,
) {
    std::thread::spawn(move || {
        let gate = &state.gate;
        let mut was_down = false;
        loop {
            gate.wait_until_active();
            let mut last = (f64::MIN, f64::MIN);
            let mut idle_emitted = false;
            while gate.is_active() {
                std::thread::sleep(Duration::from_millis(16));
                let Some(win) = window(&app) else { continue };
                let Ok(origin) = win.outer_position() else { continue };
                let scale = win.scale_factor().unwrap_or(1.0);
                let Some((cx, cy)) = platform::cursor_physical() else { continue };
                let x = (cx - origin.x as f64) / scale;
                let y = (cy - origin.y as f64) / scale;
                if (x - last.0).abs() < 1.0 && (y - last.1).abs() < 1.0 {
                    continue;
                }
                last = (x, y);

                let r = gate.rect();
                let on_island = r.w > 0.0
                    && x >= r.x - HIT_MARGIN
                    && x <= r.x + r.w + HIT_MARGIN
                    && y >= r.y - HIT_MARGIN
                    && y <= r.y + r.h + HIT_MARGIN;

                // While a button is held over the window, keep accepting: a drag
                // must not be swallowed mid-gesture.
                let down = left_size_accept(&win, x, y, platform::left_button_down());
                if down && !was_down {
                    gate.note_activity();
                }
                was_down = down;

                if on_island {
                    gate.note_activity();
                }

                let mut accept = on_island || down;
                if gate.forced_ignore() {
                    accept = false;
                }
                // Idle expanded island: tell the front end ONCE (rising edge)
                // to collapse; until the shape update lands, don't eat clicks.
                let idle = gate.expanded() && gate.idle_secs() >= IDLE_COLLAPSE_SECS;
                if idle && !idle_emitted {
                    idle_emitted = true;
                    let _ = win.emit("idle-collapse", ());
                } else if !idle {
                    idle_emitted = false;
                }
                if idle_emitted {
                    accept = on_island && !down;
                }

                if gate.ignoring() == accept {
                    gate.set_ignoring(!accept);
                    let _ = win.set_ignore_cursor_events(!accept);
                }

                let _ = win.emit("cursor", CursorPayload { x, y });
            }
        }
    });
}

fn left_size_accept<R: Runtime>(win: &WebviewWindow<R>, x: f64, y: f64, down: bool) -> bool {
    if !down {
        return false;
    }
    let scale = win.scale_factor().unwrap_or(1.0);
    let size = match win.inner_size() {
        Ok(s) => (s.width as f64 / scale, s.height as f64 / scale),
        Err(_) => (PANEL_W, PANEL_H),
    };
    x >= 0.0 && x <= size.0 && y >= 0.0 && y <= size.1
}
