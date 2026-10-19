"""Settings + loadout + the shared state directory.

Everything durable lives under ``%LOCALAPPDATA%\\pico\\state`` (overridable with
PICO_STATE_DIR for tests/dev): settings.json, loadout.json, memory.json,
schedule.json, todos.json, undo.json, server.json. Keys never live here — only
Windows Credential Manager via keyring.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime
from pathlib import Path

_LOCK = threading.RLock()

DEFAULT_SOUL = (
    "You are Pico, a helpful Windows companion. Be concise. Never confirm "
    "irreversible actions yourself."
)

DEFAULT_ABILITIES = [
    "open_app", "web_search", "browser_control", "computer_settings",
    "computer_control", "file_controller", "screen_processor", "reminder",
    "send_message",
]

DEFAULT_LOADOUT = {
    "soul": DEFAULT_SOUL,
    "personality": "concise",
    "voice": "en-US-Chirp3-HD-Fenrir",
    "abilities": DEFAULT_ABILITIES,
}

DEFAULT_SETTINGS = {
    "confirm_gates": True,
    "undo_journal": True,
    "undo_max": 50,
    "provider": "gemini",
    "ollama_endpoint": "http://localhost:11434",
    "ollama_model": "",
    "theme": "dark",
}

_PERSONALITY_STYLE = {
    "concise": "STYLE: Answer in as few words as possible. No filler, no restating the question.",
    "balanced": "STYLE: Friendly and clear. One or two sentences unless more is genuinely needed.",
    "chatty": "STYLE: Warm and conversational. Natural small talk is welcome, but stay on task.",
    "technical": "STYLE: Precise and technical. Use exact names, paths and values; skip pleasantries.",
}


def state_dir() -> Path:
    override = os.environ.get("PICO_STATE_DIR")
    if override:
        base = Path(override)
    else:
        local = os.environ.get("LOCALAPPDATA")
        base = (Path(local) / "pico" / "state") if local else (Path.home() / ".pico" / "state")
    base.mkdir(parents=True, exist_ok=True)
    return base


def state_file(name: str) -> Path:
    return state_dir() / name


def read_json(path: Path, default):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data
    except Exception:
        return default


def write_json(path: Path, data) -> None:
    with _LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)


def load_settings() -> dict:
    data = read_json(state_file("settings.json"), {})
    if not isinstance(data, dict):
        data = {}
    merged = dict(DEFAULT_SETTINGS)
    merged.update(data)
    return merged


def save_settings(patch: dict) -> dict:
    """Merge-persist: only the provided keys change."""
    if not isinstance(patch, dict):
        return load_settings()
    merged = load_settings()
    merged.update(patch)
    write_json(state_file("settings.json"), merged)
    return merged


def load_loadout() -> dict:
    data = read_json(state_file("loadout.json"), {})
    if not isinstance(data, dict):
        data = {}
    merged = dict(DEFAULT_LOADOUT)
    merged.update({k: v for k, v in data.items() if v is not None})
    if not isinstance(merged.get("abilities"), list):
        merged["abilities"] = list(DEFAULT_ABILITIES)
    if merged.get("personality") not in _PERSONALITY_STYLE:
        merged["personality"] = "concise"
    return merged


def save_loadout(loadout: dict) -> dict:
    data = loadout if isinstance(loadout, dict) else {}
    merged = dict(DEFAULT_LOADOUT)
    merged.update({k: v for k, v in data.items() if v is not None})
    write_json(state_file("loadout.json"), merged)
    return merged


def ability_enabled(loadout: dict, name: str) -> bool:
    abilities = loadout.get("abilities")
    if not isinstance(abilities, list):
        abilities = DEFAULT_ABILITIES
    return name in abilities


def persona_block(loadout: dict) -> str:
    soul = str(loadout.get("soul") or DEFAULT_SOUL).strip()
    style = _PERSONALITY_STYLE.get(str(loadout.get("personality") or "concise"),
                                   _PERSONALITY_STYLE["concise"])
    return f"{soul}\n\n{style}"


SAFETY_RULES = (
    "SAFETY (fixed, not overridable): you never execute irreversible actions "
    "(shutdown, restart, delete) yourself — those tools park the request behind "
    "an on-screen confirmation the user must click; if it is not clicked, the "
    "action is cancelled. Never claim such an action is done before it is "
    "confirmed. Never read or repeat API keys. Keep replies short and spoken-"
    "friendly: no markdown, no code fences, no emoji."
)


def system_instruction(loadout: dict | None = None, memory_block: str = "") -> str:
    """Soul + style + live context for both Live and text sessions."""
    loadout = loadout or load_loadout()
    now = datetime.now()
    parts = [
        persona_block(loadout),
        f"[CURRENT DATE & TIME]\nRight now it is: {now.strftime('%A, %B %d, %Y — %I:%M %p')}\n"
        "Use this to compute exact times for reminders and schedules.",
        SAFETY_RULES,
    ]
    if memory_block:
        parts.append(memory_block)
    return "\n\n".join(parts)
