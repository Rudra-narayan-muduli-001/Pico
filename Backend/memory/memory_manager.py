"""Long-term facts store (state/memory.json) + the prompt block and recall tool.

Ported from Mark-LV memory/memory_manager.py, slimmed: identity is always in the
prompt, other categories compete by recency up to a character budget, and keys
of everything else ride along as an index so recall_memory can find them.
"""

from __future__ import annotations

import re
import threading
from datetime import datetime

from memory.config_manager import read_json, state_file, write_json

_LOCK = threading.RLock()
MAX_VALUE_LENGTH = 380
PROMPT_CORE_CHARS = 900
PROMPT_INDEX_CHARS = 420
PROMPT_MAX_PER_CATEGORY = 6

CATEGORIES = ("identity", "preferences", "projects", "relationships", "wishes", "notes")
_IDENTITY_FIELDS = ["name", "age", "birthday", "city", "job", "language", "school"]
_CATEGORY_LABELS = {
    "preferences": "Preferences",
    "projects": "Active projects / goals",
    "relationships": "People in their life",
    "wishes": "Wishes / plans",
    "notes": "Notes",
}


def _path():
    return state_file("memory.json")


def _empty() -> dict:
    return {cat: {} for cat in CATEGORIES}


def load_memory() -> dict:
    data = read_json(_path(), {})
    if not isinstance(data, dict):
        return _empty()
    base = _empty()
    for key in base:
        base[key] = data.get(key, {}) if isinstance(data.get(key), dict) else {}
    return base


def save_memory(memory: dict) -> None:
    if isinstance(memory, dict):
        write_json(_path(), memory)


def _value(entry) -> str:
    if isinstance(entry, dict):
        return str(entry.get("value", "") or "").strip()
    return str(entry or "").strip()


def _pretty(key: str) -> str:
    return str(key).replace("_", " ").strip()


def _truncate(value: str) -> str:
    if len(value) > MAX_VALUE_LENGTH:
        return value[:MAX_VALUE_LENGTH].rstrip() + "…"
    return value


def _recursive_update(target: dict, updates: dict) -> bool:
    changed = False
    for key, value in updates.items():
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        if isinstance(value, dict) and "value" not in value:
            if not isinstance(target.get(key), dict):
                target[key] = {}
                changed = True
            if _recursive_update(target[key], value):
                changed = True
        else:
            new_val = _truncate(str(value["value"] if isinstance(value, dict) else value))
            existing = target.get(key)
            if not isinstance(existing, dict) or existing.get("value") != new_val:
                target[key] = {"value": new_val, "updated": datetime.now().strftime("%Y-%m-%d")}
                changed = True
    return changed


def update_memory(memory_update: dict) -> dict:
    if not isinstance(memory_update, dict) or not memory_update:
        return load_memory()
    with _LOCK:
        memory = load_memory()
        if _recursive_update(memory, memory_update):
            save_memory(memory)
    return memory


def remember(key: str, value: str, category: str = "notes") -> str:
    if category not in CATEGORIES:
        category = "notes"
    key = re.sub(r"[^\w\- ]+", "", str(key or "")).strip()
    if not key or not value:
        return "I need both a key and a value to remember that."
    update_memory({category: {key: {"value": value}}})
    return f"Remembered: {category}/{key} = {_truncate(str(value))}"


def forget(key: str, category: str = "notes") -> str:
    with _LOCK:
        memory = load_memory()
        cat = memory.get(category if category in CATEGORIES else "notes", {})
        if key in cat:
            del cat[key]
            save_memory(memory)
            return f"Forgotten: {category}/{key}"
    return f"Not found: {category}/{key}"


def format_for_prompt(memory: dict | None = None) -> str:
    memory = memory if isinstance(memory, dict) else load_memory()
    if not any(memory.values()):
        return ""

    core: list[str] = []
    identity = memory.get("identity", {}) or {}
    for field in _IDENTITY_FIELDS:
        val = _value(identity.get(field))
        if val:
            core.append(f"{field.title()}: {val}")
    for key, entry in identity.items():
        if key in _IDENTITY_FIELDS:
            continue
        val = _value(entry)
        if val:
            core.append(f"{_pretty(key).title()}: {val}")

    rest: list[tuple[str, str, str, str]] = []
    for cat in _CATEGORY_LABELS:
        for key, entry in (memory.get(cat, {}) or {}).items():
            val = _value(entry)
            if not val:
                continue
            updated = (entry.get("updated", "") if isinstance(entry, dict) else "") or "0000-00-00"
            rest.append((updated, cat, key, val))
    rest.sort(key=lambda t: t[0], reverse=True)

    used = sum(len(line) + 1 for line in core)
    shown: dict[str, list[str]] = {}
    overflow: dict[str, list[str]] = {}
    per_cat: dict[str, int] = {}
    for _updated, cat, key, val in rest:
        line = f"  - {_pretty(key).title()}: {val}"
        if per_cat.get(cat, 0) < PROMPT_MAX_PER_CATEGORY and used + len(line) + 1 <= PROMPT_CORE_CHARS:
            shown.setdefault(cat, []).append(line)
            per_cat[cat] = per_cat.get(cat, 0) + 1
            used += len(line) + 1
        else:
            overflow.setdefault(cat, []).append(_pretty(key))

    indexed: list[str] = []
    cats = [c for c in _CATEGORY_LABELS if overflow.get(c)]
    cursor = {c: 0 for c in cats}
    while cats:
        for cat in list(cats):
            i = cursor[cat]
            if i >= len(overflow[cat]):
                cats.remove(cat)
                continue
            indexed.append(overflow[cat][i])
            cursor[cat] = i + 1

    for cat, label in _CATEGORY_LABELS.items():
        if shown.get(cat):
            core.append("")
            core.append(f"{label}:")
            core.extend(shown[cat])

    if not core and not indexed:
        return ""

    out = ["[WHAT YOU KNOW ABOUT THIS PERSON — use naturally, never recite]"] + core
    if indexed:
        budget, names = PROMPT_INDEX_CHARS, []
        for name in indexed:
            if budget - len(name) - 2 < 0:
                break
            names.append(name)
            budget -= len(name) + 2
        if names:
            out.append("")
            out.append("[ALSO REMEMBERED — call recall_memory with a keyword to read any of these]")
            more = f" (+{len(indexed) - len(names)} more)" if len(indexed) > len(names) else ""
            out.append(", ".join(names) + more)
    return "\n".join(out) + "\n"


def search(query: str, limit: int = 8) -> str:
    memory = load_memory()
    words = [w for w in re.split(r"[^\w]+", (query or "").lower()) if len(w) > 1]
    rows: list[tuple[int, str, str, str]] = []
    for cat in CATEGORIES:
        for key, entry in (memory.get(cat, {}) or {}).items():
            val = _value(entry)
            if not val:
                continue
            score = 0
            for word in words:
                if word == key.lower():
                    score += 10
                elif word in key.lower():
                    score += 6
                if word in val.lower():
                    score += 3
            if words and score <= 0:
                continue
            rows.append((score, cat, key, val))
    if not rows:
        return (f"Nothing stored about '{query}'." if query
                else "I have not stored anything about this person yet.")
    rows.sort(key=lambda r: (-r[0], r[2]))
    lines = [f"{cat}/{_pretty(key)}: {val}" for _s, cat, key, val in rows[:max(1, limit)]]
    head = f"Stored facts matching '{query}':" if query else "Everything currently stored:"
    return head + "\n" + "\n".join(lines)
