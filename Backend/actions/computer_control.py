"""Keyboard/mouse control via pyautogui — gated ability, DEFAULT OFF.

The loadout `abilities` list decides whether the model can even see this tool.
When enabled and pyautogui is missing, every call answers with the standard
"not installed" toast text instead of crashing.
"""

from __future__ import annotations

import time

import deps

_PYGUI = None
_PROBED = False


def _pyautogui():
    global _PYGUI, _PROBED
    if not _PROBED:
        _PYGUI = deps.try_import("pyautogui")
        if _PYGUI is not None:
            try:
                _PYGUI.FAILSAFE = True
                _PYGUI.PAUSE = 0.02
            except Exception:
                pass
        _PROBED = True
    return _PYGUI


_MAX_TYPE = 2000


def run(parameters: dict, ctx: dict) -> str:
    gui = _pyautogui()
    if gui is None:
        text = deps.missing_text("pyautogui", "computer control")
        _toast(ctx, text)
        return text

    action = str(parameters.get("action") or "").strip().lower()
    try:
        if action == "type":
            text = str(parameters.get("text") or "")
            if not text:
                return "Nothing to type."
            text = text[:_MAX_TYPE]
            try:
                gui.write(text, interval=0.01)
            except Exception:
                gui.typewrite(text, interval=0.01)
            return f"Typed {len(text)} characters."

        if action == "press":
            key = str(parameters.get("key") or "").strip()
            if not key:
                return "Which key should I press?"
            keys = None
            combo = parameters.get("keys")
            if isinstance(combo, list) and combo:
                keys = [str(k) for k in combo]
            if keys:
                gui.hotkey(*keys)
                return f"Pressed {'+'.join(keys)}."
            count = int(parameters.get("times") or 1)
            for _ in range(max(1, min(20, count))):
                gui.press(key)
                time.sleep(0.05)
            return f"Pressed {key}" + (f" ×{count}" if count > 1 else "") + "."

        if action in ("click", "move"):
            x = parameters.get("x")
            y = parameters.get("y")
            if x is None or y is None:
                return "I need x and y coordinates for that."
            x, y = int(x), int(y)
            button = str(parameters.get("button") or "left")
            clicks = max(1, min(3, int(parameters.get("clicks") or 1)))
            if action == "move":
                gui.moveTo(x, y, duration=0.2)
                return f"Moved the cursor to {x},{y}."
            gui.click(x=x, y=y, clicks=clicks, button=button)
            return f"Clicked {button} at {x},{y}."

        if action == "scroll":
            amount = int(parameters.get("amount") or 5)
            x = parameters.get("x")
            y = parameters.get("y")
            if x is not None and y is not None:
                gui.moveTo(int(x), int(y), duration=0.1)
            direction = str(parameters.get("direction") or "down").lower()
            clicks = amount if direction == "up" else -amount
            gui.scroll(clicks)
            return f"Scrolled {direction}."

        if action == "position":
            pos = gui.position()
            return f"The cursor is at {int(pos.x)},{int(pos.y)}."

        return ("Unknown computer_control action. Use type, press, click, move, "
                "scroll or position.")
    except Exception as exc:
        if "failsafe" in str(exc).lower():
            return "Stopped — the cursor hit the screen corner (failsafe)."
        return f"Computer control failed: {exc}"


def _toast(ctx: dict, text: str) -> None:
    emit = ctx.get("emit")
    if callable(emit):
        emit({"dir": "ui", "type": "toast", "level": "warn", "text": text})


TOOL = {
    "name": "computer_control",
    "description": (
        "Control the mouse and keyboard directly: type text, press keys, click, "
        "move the cursor, scroll. Use for 'type X', 'press Enter', 'click at ...', "
        "'scroll down'. Prefer open_app and file_controller for their jobs."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {"type": "STRING", "description": "type | press | click | move | scroll | position"},
            "text": {"type": "STRING", "description": "Text to type (action=type)"},
            "key": {"type": "STRING", "description": "Key name, e.g. enter, tab, esc (action=press)"},
            "keys": {"type": "ARRAY", "items": {"type": "STRING"}, "description": "Key combo, e.g. ['ctrl','s']"},
            "times": {"type": "INTEGER", "description": "Repeat count for press"},
            "x": {"type": "INTEGER", "description": "Screen X"},
            "y": {"type": "INTEGER", "description": "Screen Y"},
            "button": {"type": "STRING", "description": "left | right | middle"},
            "clicks": {"type": "INTEGER", "description": "Click count"},
            "direction": {"type": "STRING", "description": "up | down (scroll)"},
            "amount": {"type": "INTEGER", "description": "Scroll amount"},
        },
        "required": ["action"],
    },
    "ability": "computer_control",
    "handler": run,
}
