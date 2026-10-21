"""Search the web in the default browser (keyless, no API needed)."""

from __future__ import annotations

import webbrowser
from urllib.parse import quote_plus

_ENGINES = {
    "google": "https://www.google.com/search?q={q}",
    "bing": "https://www.bing.com/search?q={q}",
    "duckduckgo": "https://duckduckgo.com/?q={q}",
    "youtube": "https://www.youtube.com/results?search_query={q}",
    "amazon": "https://www.amazon.com/s?k={q}",
    "wikipedia": "https://en.wikipedia.org/w/index.php?search={q}",
    "github": "https://github.com/search?q={q}",
}


def search_url(query: str, engine: str = "google") -> str:
    template = _ENGINES.get(str(engine or "").strip().lower(), _ENGINES["google"])
    return template.format(q=quote_plus(str(query or "").strip()))


def run(parameters: dict, ctx: dict) -> str:
    query = str(parameters.get("query") or "").strip()
    engine = str(parameters.get("engine") or "google").strip().lower()
    if not query:
        return "What should I search for?"
    site = str(parameters.get("site") or "").strip()
    if site:
        query = f"{query} site:{site}"
    url = search_url(query, engine)
    try:
        webbrowser.open(url)
    except Exception as exc:
        return f"Could not open the browser: {exc}"
    name = engine if engine in _ENGINES else "google"
    return f"Searched {name} for “{query}”."


TOOL = {
    "name": "web_search",
    "description": (
        "Search the web in the default browser. Use for 'search for X', "
        "'google X', 'look up X on YouTube' (engine='youtube') and similar. "
        "This just opens the results page; it does not read the results back."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "query": {"type": "STRING", "description": "What to search for"},
            "engine": {
                "type": "STRING",
                "description": "google | bing | duckduckgo | youtube | amazon | wikipedia | github",
            },
            "site": {"type": "STRING", "description": "Optional site: filter, e.g. reddit.com"},
        },
        "required": ["query"],
    },
    "ability": "web_search",
    "handler": run,
}
