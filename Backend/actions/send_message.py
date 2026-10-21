"""Compose emails / WhatsApp messages — never sends silently.

Both channels open the compose surface (mail client or WhatsApp) with the text
pre-filled; the user presses Send. That is the whole safety model for messaging
in v1.
"""

from __future__ import annotations

import re
from urllib.parse import quote

from winplat import windows


def _email_url(to: str, subject: str, body: str) -> str:
    params = []
    if subject:
        params.append("subject=" + quote(subject))
    if body:
        params.append("body=" + quote(body))
    query = ("?" + "&".join(params)) if params else ""
    return f"mailto:{quote(to)}{query}"


def _whatsapp_url(to: str, text: str) -> str:
    digits = re.sub(r"\D", "", to)
    base = f"https://wa.me/{digits}" if digits else "https://wa.me/"
    return f"{base}?text={quote(text)}" if text else base


def run(parameters: dict, ctx: dict) -> str:
    to = str(parameters.get("to") or "").strip()
    text = str(parameters.get("text") or parameters.get("message") or "").strip()
    subject = str(parameters.get("subject") or "").strip()
    channel = str(parameters.get("channel") or "email").strip().lower()

    if channel in ("email", "mail"):
        if not to:
            return "Who should the email go to?"
        return windows.open_path(_email_url(to, subject, text)) + \
            " Review it and press Send when you are ready."

    if channel in ("whatsapp", "wa"):
        if not to and not text:
            return "I need a number or a message for WhatsApp."
        return windows.open_path(_whatsapp_url(to, text)) + \
            " Review it and press Send when you are ready."

    return f"Unknown message channel: {channel} (use email or whatsapp)."


TOOL = {
    "name": "send_message",
    "description": (
        "Compose an email or a WhatsApp message with the text pre-filled. It "
        "never sends by itself — it opens the compose window and the user sends. "
        "Use for 'email X about…' / 'message X on WhatsApp…'."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "channel": {"type": "STRING", "description": "email | whatsapp"},
            "to": {"type": "STRING", "description": "Email address or phone number"},
            "subject": {"type": "STRING", "description": "Email subject"},
            "text": {"type": "STRING", "description": "Message body"},
        },
        "required": ["channel", "to", "text"],
    },
    "ability": "send_message",
    "handler": run,
}
