"""Open URLs and read page text.

Deeper Playwright-driven browsing (clicking, typing, navigating a live page) is
deliberately deferred to a later phase; `read` fetches and strips the page with
requests so the model gets real content today. ponytail: requests-only reader;
interactive Playwright control is the known upgrade path.
"""

from __future__ import annotations

import re
import webbrowser
from urllib.parse import urlparse


def _clean_url(url: str) -> str | None:
    url = str(url or "").strip()
    if not url:
        return None
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", url):
        url = "https://" + url
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return None
    if not parsed.netloc:
        return None
    return url


def _strip_html(html: str) -> str:
    html = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html)
    text = re.sub(r"(?s)<[^>]+>", " ", html)
    text = re.sub(r"&nbsp;?", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&lt;", "<", text)
    text = re.sub(r"&gt;", ">", text)
    text = re.sub(r"&quot;?", '"', text)
    text = re.sub(r"&#\d+;", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def run(parameters: dict, ctx: dict) -> str:
    action = str(parameters.get("action") or "open").strip().lower()
    url = _clean_url(parameters.get("url") or "")
    if url is None:
        return "I need an http or https URL for that."

    if action == "open":
        try:
            webbrowser.open(url)
            return f"Opened {url}."
        except Exception as exc:
            return f"Could not open the browser: {exc}"

    if action == "read":
        try:
            import requests
        except Exception:
            return "The requests package is not installed — page reading disabled."
        try:
            resp = requests.get(url, timeout=12, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Pico/0.1",
            })
            resp.raise_for_status()
            text = _strip_html(resp.text)
            if not text:
                return f"{url} returned no readable text."
            excerpt = text[:4000]
            more = " [truncated]" if len(text) > len(excerpt) else ""
            return f"Content of {url}:\n{excerpt}{more}"
        except Exception as exc:
            return f"Could not read {url}: {exc}"

    return f"Unknown browser action: {action}"


TOOL = {
    "name": "browser_control",
    "description": (
        "Open a URL in the default browser ('open'), or fetch a page and return "
        "its readable text ('read', useful for answering questions about a page)."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {"type": "STRING", "description": "open | read (default open)"},
            "url": {"type": "STRING", "description": "http/https URL"},
        },
        "required": ["url"],
    },
    "ability": "browser_control",
    "handler": run,
}
