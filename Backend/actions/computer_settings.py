"""Windows settings: volume, mute, lock, shutdown/restart (confirm-gated).

Brightness and Wi-Fi toggling need driver-level access that v1 deliberately
skips; they answer with a clear "not supported yet" instead of pretending.
"""

from __future__ import annotations

import confirm
from winplat import windows

_DESTRUCTIVE = {"shutdown", "restart", "sleep"}


def run(parameters: dict, ctx: dict) -> str:
    action = str(parameters.get("action") or "").strip().lower()
    amount = int(parameters.get("amount") or 0)

    if action in ("volume_up", "volume_down"):
        steps = amount if amount > 0 else 5
        return windows.volume_step("up" if action == "volume_up" else "down", steps)

    if action == "mute":
        return windows.volume_mute()

    if action == "lock":
        return windows.lock_workstation()

    if action in _DESTRUCTIVE:
        if ctx.get("in_confirm"):
            return _do_destructive(action)
        detail = ("This will shut the PC down." if action == "shutdown"
                  else "This will restart the PC.")
        if confirm.request(f"{action.title()} this PC", detail):
            return _do_destructive(action)
        return f"I did not {action} the PC — the confirmation was not clicked."

    if action == "brightness":
        return ("Brightness control is not supported yet on this build. "
                "Use the Windows action center for now.")
    if action == "wifi":
        return ("Wi-Fi toggling is not supported yet on this build. "
                "Use the Windows quick settings for now.")

    return ("Unknown settings action. Use volume_up, volume_down, mute, lock, "
            "shutdown or restart.")


def _do_destructive(action: str) -> str:
    if action == "shutdown":
        return windows.shutdown(restart=False)
    if action == "restart":
        return windows.shutdown(restart=True)
    return "Sleep is not supported yet."


TOOL = {
    "name": "computer_settings",
    "description": (
        "Change Windows settings: volume up/down, mute, lock the PC, shut down "
        "or restart. Shutdown and restart need an on-screen confirmation the "
        "user must click — if they do not, nothing happens."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {
                "type": "STRING",
                "description": "volume_up | volume_down | mute | lock | shutdown | restart | brightness | wifi",
            },
            "amount": {"type": "INTEGER", "description": "Steps for volume (default 5)"},
        },
        "required": ["action"],
    },
    "ability": "computer_settings",
    "handler": run,
}
