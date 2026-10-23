// Settings surface (Design.md "Settings Window 1000×700"): left rail —
// Keys / Providers / Loadout / Safety / General / About.
//
// Keys go to Windows Credential Manager (DPAPI) via the Tauri keyring
// commands (service "pico"); the brain is told {"dir":"py","cmd":"save_key"}
// so it can refresh. Non-secret settings persist to
// %LOCALAPPDATA%\pico\state\settings.json AND mirror to the brain as
// {"dir":"py","cmd":"save_setting","settings":{...}} — if the brain is
// offline the UI keeps working locally and shows "Brain offline".

import { useCallback, useEffect, useRef, useState } from "react";
import { applyAppearance } from "../lib/appearance";
import {
  appVersion,
  autostartGet,
  autostartSet,
  deleteKey,
  keyPresent,
  onMessage,
  reconnect,
  saveLoadout,
  send,
  sendKey,
  settingsLoad,
  settingsSave,
  type ToastMsg,
  type UiMsg,
} from "../lib/bridge";

type Tab = "keys" | "providers" | "loadout" | "safety" | "general" | "about";

const TABS: [Tab, string][] = [
  ["keys", "Keys"],
  ["providers", "Providers"],
  ["loadout", "Loadout"],
  ["safety", "Safety"],
  ["general", "General"],
  ["about", "About"],
];

/** Providers with a pasted API key (Ollama has an endpoint instead). */
const KEY_PROVIDERS: { id: string; name: string }[] = [
  { id: "gemini", name: "Gemini" },
  { id: "claude", name: "Claude" },
  { id: "openai", name: "OpenAI" },
];

const TEXT_PROVIDERS = ["gemini", "claude", "openai", "ollama"];

const VOICES = [
  "en-US-Chirp3-HD-Fenrir",
  "en-US-Chirp3-HD-Charon",
  "en-US-Chirp3-HD-Kore",
  "en-US-Chirp3-HD-Puck",
  "en-US-Chirp3-HD-Aoede",
];

const ABILITIES: { id: string; desc: string; risky?: boolean }[] = [
  { id: "open_app", desc: "Open applications" },
  { id: "web_search", desc: "Search the web" },
  { id: "browser_control", desc: "Drive the browser" },
  { id: "computer_control", desc: "Mouse/keyboard control" },
  { id: "computer_settings", desc: "Windows settings (volume, Wi-Fi…)" },
  { id: "file_controller", desc: "Create / move / delete files" },
  { id: "screen_processor", desc: "Read your screen" },
  { id: "reminder", desc: "Reminders & schedules" },
  { id: "send_message", desc: "Send messages" },
  { id: "terminal", desc: "Run terminal commands — opt-in only", risky: true },
  { id: "raw_automation", desc: "Raw desktop automation — opt-in only", risky: true },
];

interface Settings {
  confirm_gates?: boolean;
  undo_journal?: boolean;
  undo_max?: number;
  risky_terminal?: boolean;
  risky_raw_automation?: boolean;
  reduced_motion?: boolean;
  theme?: "dark" | "light" | "system";
  provider?: string;
  ollama_endpoint?: string;
  ollama_model?: string;
}

const DEFAULT_LOADOUT = {
  soul: "You are Pico, a helpful Windows companion. Be concise. Never confirm irreversible actions yourself.",
  personality: "concise",
  voice: VOICES[0],
  abilities: ABILITIES.filter((a) => !a.risky).map((a) => a.id),
};

export default function SettingsApp() {
  const [tab, setTab] = useState<Tab>("keys");
  const [settings, setSettings] = useState<Settings>({});
  const [loadout, setLoadout] = useState<Record<string, unknown>>(DEFAULT_LOADOUT);
  const [version, setVersion] = useState("0.1.0");
  const [autostart, setAutostart] = useState(false);
  const [connected, setConnected] = useState(false);
  const [keyState, setKeyState] = useState<
    Record<string, { present: boolean; testing?: boolean; result?: string }>
  >({});
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [toasts, setToasts] = useState<(ToastMsg & { key: number })[]>([]);
  const toastKey = useRef(0);

  const toast = useCallback((text: string, level: ToastMsg["level"] = "info") => {
    const key = ++toastKey.current;
    setToasts((prev) => [...prev, { type: "toast", level, text, key }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.key !== key)), 3000);
  }, []);

  useEffect(() => {
    settingsLoad()
      .then((s) => {
        setSettings(s as Settings);
        applyAppearance(s as Settings);
      })
      .catch(() => {});
    autostartGet().then(setAutostart).catch(() => {});
    appVersion().then(setVersion).catch(() => {});
    for (const p of KEY_PROVIDERS) {
      keyPresent(p.id)
        .then((present) => setKeyState((prev) => ({ ...prev, [p.id]: { ...prev[p.id], present } })))
        .catch(() => {});
    }
  }, []);

  // dir:"ui" — link status + key test results (Rust mirrors them here too).
  useEffect(() => {
    let un: (() => void) | undefined;
    onMessage((msg: UiMsg) => {
      if (msg.type === "link") {
        setConnected(!!(msg as { connected: boolean }).connected);
      }
      if (msg.type === "key_test_result") {
        const m = msg as { provider: string; ok: boolean; error?: string };
        setKeyState((prev) => ({
          ...prev,
          [m.provider]: {
            ...prev[m.provider],
            testing: false,
            result: m.ok ? "OK" : `failed: ${m.error ?? "unknown"}`,
          },
        }));
      }
      if (msg.type === "toast") {
        const t = msg as ToastMsg;
        toast(t.text, t.level);
      }
    }).then((f) => (un = f));
    return () => un?.();
  }, [toast]);

  /** Persist locally (always) and mirror to the brain (best-effort). */
  const patchSettings = (patch: Settings) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    applyAppearance(next);
    settingsSave(next).catch(() => {});
    send({ cmd: "save_setting", settings: next }).catch(() => {});
  };

  const onAutostart = (on: boolean) => {
    setAutostart(on);
    autostartSet(on).catch(() => setAutostart(!on));
  };

  // ── Keys ────────────────────────────────────────────────────────────────────

  const saveKey_ = async (providerId: string, input: HTMLInputElement) => {
    const value = input.value;
    if (!value) return;
    try {
      await sendKey(providerId, value); // Credential Manager is authoritative
    } catch {
      toast(`Could not save ${providerId} key`, "error");
      return;
    }
    input.value = "";
    setKeyState((prev) => ({ ...prev, [providerId]: { ...prev[providerId], present: true, result: undefined } }));
    // Design.md protocol: tell the brain a key changed (it re-reads the
    // credential manager itself).
    send({ cmd: "save_key", provider: providerId, key: value }).catch(() => {});
  };

  const clearKey = async (providerId: string) => {
    try {
      await deleteKey(providerId);
    } catch {
      /* clearing an absent key is fine */
    }
    setKeyState((prev) => ({ ...prev, [providerId]: { present: false, result: undefined } }));
    toast(`${providerId} key cleared`);
  };

  const testKey = (providerId: string) => {
    setKeyState((prev) => ({
      ...prev,
      [providerId]: { ...prev[providerId], testing: true, result: undefined },
    }));
    // The brain reads the key from Credential Manager itself — it never comes
    // through the webview. Replies as dir:"ui" key_test_result.
    send({ cmd: "test_key", provider: providerId }).catch(() => {
      setKeyState((prev) => ({
        ...prev,
        [providerId]: { ...prev[providerId], testing: false, result: "brain offline" },
      }));
    });
  };

  // ── Loadout ─────────────────────────────────────────────────────────────────

  const saveLoadout_ = () => {
    saveLoadout(loadout)
      .then(() => toast("Loadout saved"))
      .catch(() => {});
  };

  const previewVoice = (voice: string) => {
    setPreviewing(voice);
    send({ cmd: "preview_voice", voice }).catch(() => {
      setPreviewing(null);
      toast("Brain offline — preview unavailable", "warn");
    });
    setTimeout(() => setPreviewing(null), 4000);
  };

  const abilities = Array.isArray(loadout.abilities) ? (loadout.abilities as string[]) : [];

  return (
    <div className="settings-shell">
      <nav className="settings-rail" aria-label="Settings tabs">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <div className={`brain-status${connected ? " ok" : ""}`} aria-live="polite">
          {connected ? "Brain online" : "Brain offline"}
        </div>
      </nav>

      <main className="settings-main">
        {tab === "keys" && (
          <>
            <h1>Keys</h1>
            <p className="hint">
              Stored in Windows Credential Manager (DPAPI). Saved keys are never shown again — only
              replaced or cleared.
            </p>
            {KEY_PROVIDERS.map((p) => (
              <div className="card" key={p.id}>
                <div className="field">
                  <label htmlFor={`key-${p.id}`}>{p.name} API key</label>
                  <div className="row">
                    <input
                      type="password"
                      className="input"
                      placeholder={keyState[p.id]?.present ? "•••••••• (saved)" : "paste key…"}
                      aria-label={`${p.name} API key`}
                      id={`key-${p.id}`}
                    />
                    <button
                      className="btn"
                      onClick={() => {
                        const el = document.getElementById(`key-${p.id}`) as HTMLInputElement | null;
                        if (el) saveKey_(p.id, el);
                      }}
                    >
                      Save
                    </button>
                    <button
                      className="btn"
                      disabled={!connected || !keyState[p.id]?.present || keyState[p.id]?.testing}
                      title={connected ? undefined : "Brain offline"}
                      onClick={() => testKey(p.id)}
                    >
                      {keyState[p.id]?.testing ? "Testing…" : "Test"}
                    </button>
                    <button className="btn danger" onClick={() => clearKey(p.id)}>
                      Clear
                    </button>
                  </div>
                </div>
                <span className={`badge ${keyState[p.id]?.present ? "ok" : ""}`}>
                  {keyState[p.id]?.present ? "saved" : "not set"}
                </span>
                {keyState[p.id]?.result && (
                  <span
                    className={`badge${keyState[p.id]?.result === "OK" ? " ok" : " err"}`}
                    style={{ marginLeft: 6 }}
                  >
                    {keyState[p.id]?.result}
                  </span>
                )}
              </div>
            ))}

            <div className="settings-section">
              <h2>Ollama (local)</h2>
              <div className="field">
                <label htmlFor="ollama-endpoint">Endpoint</label>
                <input
                  id="ollama-endpoint"
                  className="input"
                  defaultValue={settings.ollama_endpoint ?? "http://localhost:11434"}
                  onBlur={(e) => patchSettings({ ollama_endpoint: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="ollama-model">Model</label>
                <input
                  id="ollama-model"
                  className="input"
                  defaultValue={settings.ollama_model ?? ""}
                  placeholder="e.g. llama3.1"
                  onBlur={(e) => patchSettings({ ollama_model: e.target.value })}
                />
              </div>
            </div>
          </>
        )}

        {tab === "providers" && (
          <>
            <h1>Providers</h1>
            <div className="settings-section">
              <h2>Default text provider</h2>
              <div role="radiogroup" aria-label="Default provider" style={{ display: "grid", gap: 8 }}>
                {TEXT_PROVIDERS.map((p) => (
                  <label key={p} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="radio"
                      name="provider"
                      checked={settings.provider === p || (!settings.provider && p === "gemini")}
                      onChange={() => patchSettings({ provider: p })}
                    />
                    {p}
                  </label>
                ))}
              </div>
            </div>
            <div className="card">
              <strong>Voice — Gemini Live (locked)</strong>
              <p className="hint" style={{ marginTop: 6 }}>
                Realtime voice runs on Gemini Live only for v1: it is the only native-audio
                realtime API among the supported providers. Claude/OpenAI/Ollama serve text chat.
              </p>
            </div>
          </>
        )}

        {tab === "loadout" && (
          <>
            <h1>Loadout</h1>
            <div className="field">
              <label htmlFor="soul">Soul (system prompt)</label>
              <textarea
                id="soul"
                className="input"
                defaultValue={String(loadout.soul ?? "")}
                onChange={(e) => setLoadout({ ...loadout, soul: e.target.value })}
                onFocus={() => {}}
                maxLength={4000}
              />
              <p className="hint">{String(loadout.soul ?? "").length}/4000</p>
            </div>
            <div className="field">
              <label>Personality</label>
              <div className="seg" role="radiogroup" aria-label="Personality">
                {["concise", "balanced", "chatty", "technical"].map((p) => (
                  <button
                    key={p}
                    className={loadout.personality === p ? "active" : ""}
                    aria-pressed={loadout.personality === p}
                    onClick={() => setLoadout({ ...loadout, personality: p })}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Voice (Gemini Live)</label>
              <div className="voice-grid" role="radiogroup" aria-label="Voice">
                {VOICES.map((v) => (
                  <div key={v} className={`voice-card${loadout.voice === v ? " active" : ""}`}>
                    <button
                      className="voice-name"
                      aria-pressed={loadout.voice === v}
                      onClick={() => setLoadout({ ...loadout, voice: v })}
                    >
                      {v.split("-").pop()}
                    </button>
                    <button
                      className="btn"
                      aria-label={`Preview ${v}`}
                      disabled={previewing === v}
                      onClick={() => previewVoice(v)}
                    >
                      {previewing === v ? "♪…" : "▶"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Abilities</label>
              <div className="ability-grid">
                {ABILITIES.map((a) => {
                  const on = abilities.includes(a.id);
                  return (
                    <div key={a.id} className={`card ability${a.risky ? " risky" : ""}${on ? " on" : ""}`}>
                      <div className="toggle-row" style={{ borderBottom: "none", padding: 0 }}>
                        <div>
                          <div className="ability-id">
                            {a.id}
                            {a.risky && <span className="badge err" style={{ marginLeft: 6 }}>risky</span>}
                          </div>
                          <div className="desc">{a.desc}</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={on}
                          aria-label={`Ability ${a.id}`}
                          onChange={(e) =>
                            setLoadout({
                              ...loadout,
                              abilities: e.target.checked
                                ? [...abilities, a.id]
                                : abilities.filter((x) => x !== a.id),
                            })
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <button className="btn accent" onClick={saveLoadout_}>
              Save loadout
            </button>
          </>
        )}

        {tab === "safety" && (
          <>
            <h1>Safety</h1>
            <div className="settings-section">
              <div className="toggle-row">
                <div>
                  <div>Confirm gates</div>
                  <div className="desc">Physical click required for irreversible ops</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.confirm_gates ?? true}
                  aria-label="Confirm gates"
                  onChange={(e) => patchSettings({ confirm_gates: e.target.checked })}
                />
              </div>
              <div className="toggle-row">
                <div>
                  <div>Undo journal</div>
                  <div className="desc">Every file mutation can be reversed</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.undo_journal ?? true}
                  aria-label="Undo journal"
                  onChange={(e) => patchSettings({ undo_journal: e.target.checked })}
                />
              </div>
              <div className="toggle-row">
                <div>
                  <div>Undo history size</div>
                  <div className="desc">Entries kept in the undo journal</div>
                </div>
                <input
                  type="number"
                  className="input num"
                  min={1}
                  max={500}
                  value={settings.undo_max ?? 50}
                  aria-label="Undo history size"
                  onChange={(e) => patchSettings({ undo_max: Number(e.target.value) || 50 })}
                />
              </div>
            </div>
            <div className="settings-section">
              <h2>Risky tools</h2>
              <div className="card risky-card">
                <div className="toggle-row" style={{ borderBottom: "none" }}>
                  <div>
                    <div>Terminal</div>
                    <div className="desc">Run shell commands — off by default</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={!!settings.risky_terminal}
                    aria-label="Terminal tool"
                    onChange={(e) => patchSettings({ risky_terminal: e.target.checked })}
                  />
                </div>
              </div>
              <div className="card risky-card">
                <div className="toggle-row" style={{ borderBottom: "none" }}>
                  <div>
                    <div>Raw desktop automation</div>
                    <div className="desc">Unrestricted input synthesis — off by default</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={!!settings.risky_raw_automation}
                    aria-label="Raw desktop automation"
                    onChange={(e) => patchSettings({ risky_raw_automation: e.target.checked })}
                  />
                </div>
              </div>
            </div>
            <div className="card">
              <strong>Secure surfaces</strong>
              <p className="hint" style={{ marginTop: 6 }}>
                Dictation can never type into UAC prompts, the lock screen, or anti-cheat
                surfaces — Windows blocks synthetic input there. Pico toasts "Can't type here
                (secure surface)" instead of failing silently.
              </p>
            </div>
          </>
        )}

        {tab === "general" && (
          <>
            <h1>General</h1>
            <div className="settings-section">
              <div className="toggle-row">
                <div>
                  <div>Start Pico with Windows</div>
                  <div className="desc">Per-user, no admin</div>
                </div>
                <input
                  type="checkbox"
                  checked={autostart}
                  aria-label="Autostart"
                  onChange={(e) => onAutostart(e.target.checked)}
                />
              </div>
              <div className="toggle-row">
                <div>
                  <div>Reduced motion</div>
                  <div className="desc">Disables spring animations and avatar breathing</div>
                </div>
                <input
                  type="checkbox"
                  checked={!!settings.reduced_motion}
                  aria-label="Reduced motion"
                  onChange={(e) => patchSettings({ reduced_motion: e.target.checked })}
                />
              </div>
              <div className="toggle-row">
                <div>
                  <div>Theme</div>
                  <div className="desc">Dark is the default (Windows 11 Mica-aligned)</div>
                </div>
                <select
                  className="input select"
                  value={settings.theme ?? "dark"}
                  aria-label="Theme"
                  onChange={(e) =>
                    patchSettings({ theme: e.target.value as Settings["theme"] })
                  }
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="system">System</option>
                </select>
              </div>
            </div>
            <div className="settings-section">
              <h2>Hotkeys</h2>
              <p className="hint">
                Remapping lands with configurable bindings in a later phase. Current defaults:
              </p>
              <div className="hotkey-list">
                <div>
                  Talk (hold) <kbd>Ctrl</kbd>+<kbd>Space</kbd>
                </div>
                <div>
                  Dictate (hold) <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd>
                </div>
                <div>
                  Circle-to-ask <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Q</kbd>
                </div>
                <div>
                  Cancel circle <kbd>Esc</kbd>
                </div>
              </div>
            </div>
          </>
        )}

        {tab === "about" && (
          <>
            <h1>About Pico</h1>
            <div className="card">
              <p>
                Version {version} — MIT licensed
              </p>
              <p className="hint" style={{ marginTop: 8 }}>
                Pico is free and open source. Your keys, your data, no telemetry. GitHub repository
                link lands with the public release.
              </p>
            </div>
            <div className="settings-section">
              <h2>Maintenance</h2>
              <div className="row" style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={() => send({ cmd: "ping" }).catch(() => toast("Brain offline", "warn"))}>
                  Ping brain
                </button>
                <button className="btn" onClick={() => reconnect().catch(() => {})}>
                  Reconnect
                </button>
                <button className="btn" disabled title="Updater is wired in Phase 7">
                  Check for updates
                </button>
              </div>
            </div>
          </>
        )}
      </main>

      <div className="toast-stack" aria-live="assertive">
        {toasts.map((t) => (
          <div key={t.key} className={`toast ${t.level}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
