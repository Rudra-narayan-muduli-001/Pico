// The ONLY front-end line to anything outside the webview.
//
//   surfaces never touch Tauri or the brain directly beyond this file:
//   send(msg)      → invoke("pico_send_ws") → Rust → WS → Python brain
//                    (a frame with dir:"win" is executed by Rust locally)
//   onMessage(cb)  ← listen("pico-ui")      ← Rust ← WS ← Python (dir:"ui")
//
// Message shapes follow Design.md "Tauri ↔ Python Protocol (WS)".

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type VoiceState = "idle" | "listening" | "processing" | "speaking";

export interface TranscriptMsg {
  type: "transcript";
  role: "user" | "assistant" | "tool";
  text: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
}
export interface VoiceStateMsg {
  type: "voice_state";
  state: VoiceState;
}
export interface ToastMsg {
  type: "toast";
  level: "info" | "warn" | "error";
  text: string;
  duration?: number;
}
export interface PanelUpdateMsg {
  type: "panel_update";
  panel: "music" | "clipboard" | "plans" | "apps" | "wallpapers" | string;
  data: unknown;
}
export interface ScheduleFiredMsg {
  type: "schedule_fired";
  id: string;
  prompt: string;
  result: string;
}
export interface LinkMsg {
  type: "link";
  connected: boolean;
}
export interface KeyTestMsg {
  type: "key_test_result";
  provider: string;
  ok: boolean;
  error?: string;
}
export type UiMsg = (
  | TranscriptMsg
  | VoiceStateMsg
  | ToastMsg
  | PanelUpdateMsg
  | ScheduleFiredMsg
  | LinkMsg
  | KeyTestMsg
  | { type: string; [k: string]: unknown }
) & { dir?: string };

/** UI → backend. dir defaults to "py" (brain); "win" frames stay in Rust. */
export function send(msg: Record<string, unknown>): Promise<void> {
  const frame = msg.dir ? msg : { dir: "py", ...msg };
  return invoke("pico_send_ws", { json: JSON.stringify(frame) });
}

/** UI → Rust window op (Design.md "Window Ops"). */
export function sendWin(op: string, extra?: Record<string, unknown>): Promise<void> {
  return send({ dir: "win", op, ...extra });
}

export function onMessage(cb: (msg: UiMsg) => void): Promise<() => void> {
  return listen<UiMsg>("pico-ui", (e) => cb(e.payload));
}

/** Cursor over the island window, logical px. Fed by the Rust poll at ~60 Hz. */
export function onCursor(cb: (x: number, y: number) => void): Promise<() => void> {
  return listen<{ x: number; y: number }>("cursor", (e) => cb(e.payload.x, e.payload.y));
}

/** Rust asks the island to collapse (idle timeout fired in the poll). */
export function onIdleCollapse(cb: () => void): Promise<() => void> {
  return listen("idle-collapse", () => cb());
}

/** Circle page: fresh gesture (active:true) or teardown (active:false). */
export function onCircleMode(cb: (active: boolean) => void): Promise<() => void> {
  return listen<{ active: boolean }>("circle_mode", (e) => cb(e.payload.active));
}

/** Circle page: dropped by Rust whenever the overlay is hidden. */
export function onCircleReset(cb: () => void): Promise<() => void> {
  return listen("circle-reset", () => cb());
}

// ── Island window contract ────────────────────────────────────────────────────

/** Push the island's drawn shape; only it takes the mouse (click-through). */
export function setIslandShape(width: number, height: number): Promise<void> {
  return invoke("set_island_shape", { x: 0, y: 0, width, height });
}

/** A text field needs real focus: WS_EX_NOACTIVATE has to go away first. */
export function focusWindow(focused: boolean): Promise<void> {
  return invoke("focus_window", { focused });
}

// ── Keyring (Windows Credential Manager; service "pico") ─────────────────────

export const sendKey = (provider: string, key: string): Promise<void> =>
  invoke("save_key", { provider, key });
export const loadKey = (provider: string): Promise<string | null> =>
  invoke("load_key", { provider });
export const deleteKey = (provider: string): Promise<void> =>
  invoke("delete_key", { provider });
/** "Is a key saved?" — never returns the secret. */
export const keyPresent = (provider: string): Promise<boolean> =>
  invoke("key_present", { provider });

// ── Settings / misc commands ──────────────────────────────────────────────────

export const getServerPort = (): Promise<number> => invoke("get_server_port");
export const reconnect = (): Promise<void> => invoke("pico_reconnect");
export const settingsLoad = (): Promise<Record<string, unknown>> => invoke("settings_load");
export const settingsSave = (settings: Record<string, unknown>): Promise<void> =>
  invoke("settings_save", { settings });
export const saveLoadout = (loadout: Record<string, unknown>): Promise<void> =>
  invoke("save_loadout", { loadout });
export const autostartGet = (): Promise<boolean> => invoke("autostart_get");
export const autostartSet = (enabled: boolean): Promise<void> =>
  invoke("autostart_set", { enabled });
export const appVersion = (): Promise<string> => invoke("app_version");
export const openSettingsWindow = (): Promise<void> => invoke("open_settings_window");
export const circleHide = (): Promise<void> => invoke("circle_hide");
