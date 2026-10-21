"""Reminders, scheduled routines and to-dos — backed by the scheduler store."""

from __future__ import annotations


def run(parameters: dict, ctx: dict) -> str:
    services = ctx.get("services")
    if services is None:
        return "Reminders are not available right now."

    action = str(parameters.get("action") or "").strip().lower()
    prompt = str(parameters.get("prompt") or parameters.get("text") or "").strip()

    if action == "add_once":
        at = str(parameters.get("at") or "").strip()
        if not prompt or not at:
            return "I need both a prompt and an exact time (ISO) for that reminder."
        ok, message = services.add_once(prompt, at)
        return message if ok else f"I could not schedule that: {message}"

    if action == "add_cron":
        cron = str(parameters.get("schedule") or parameters.get("cron") or "").strip()
        if not prompt or not cron:
            return "I need both a prompt and a cron expression for that routine."
        ok, message = services.add_cron(prompt, cron)
        return message if ok else f"I could not schedule that: {message}"

    if action == "add_todo":
        if not prompt:
            return "What should the to-do say?"
        ok, message = services.add_todo(prompt)
        return message if ok else f"I could not add that: {message}"

    if action == "complete_todo":
        if not prompt:
            return "Which to-do is done?"
        return services.complete_todo(prompt)

    if action == "remove":
        target = str(parameters.get("id") or prompt).strip()
        return services.remove_schedule(target)

    if action == "list":
        return services.plans_listing()

    return ("Unknown reminder action. Use add_once, add_cron, add_todo, "
            "complete_todo, remove or list.")


TOOL = {
    "name": "reminder",
    "description": (
        "Create reminders, scheduled routines and to-dos. Use add_once with an "
        "exact ISO timestamp (compute it from the current date & time), add_cron "
        "for repeating routines (5-field cron), add_todo for the island's To-Do "
        "list. list shows everything stored."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {"type": "STRING", "description": "add_once | add_cron | add_todo | complete_todo | remove | list"},
            "prompt": {"type": "STRING", "description": "What to do / remember"},
            "at": {"type": "STRING", "description": "ISO local timestamp for one-shots, e.g. 2026-10-15T09:00:00"},
            "schedule": {"type": "STRING", "description": "5-field cron for routines, e.g. '0 9 * * *'"},
            "id": {"type": "STRING", "description": "Schedule id for remove"},
        },
        "required": ["action"],
    },
    "ability": "reminder",
    "handler": run,
}
