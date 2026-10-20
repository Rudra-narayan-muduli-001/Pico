"""File operations with path validation, a confirm gate for delete, and a full
undo journal. Deletes move to state/trash instead of vanishing, so "undo"
restores them.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import confirm
import undo
from memory.config_manager import state_dir

_MAX_LIST = 120
_MAX_READ = 6000


def _home() -> Path:
    return Path.home()


def _validated(raw: str, must_exist: bool = False) -> tuple[Path | None, str]:
    """Resolve a model-provided path. Outside the user's home requires a click."""
    text = str(raw or "").strip().strip('"')
    if not text:
        return None, "I need a path for that."
    path = Path(text).expandvars().expanduser()
    if not path.is_absolute():
        path = _home() / path
    try:
        path = path.resolve()
    except Exception as exc:
        return None, f"That path does not resolve: {exc}"
    home = _home().resolve()
    inside = path == home or home in path.parents
    if not inside:
        if not confirm.request(
            f"Access outside your home folder",
            f"The path {path} is outside {home}. Allow this one file operation?",
        ):
            return None, "That path is outside your home folder and was not confirmed."
    if must_exist and not path.exists():
        return None, f"There is nothing at {path}."
    return path, ""


def _trash_dir() -> Path:
    d = state_dir() / "trash" / uuid.uuid4().hex[:8]
    d.mkdir(parents=True, exist_ok=True)
    return d


def run(parameters: dict, ctx: dict) -> str:
    action = str(parameters.get("action") or "").strip().lower()
    raw_path = parameters.get("path") or parameters.get("src") or ""

    if action == "list":
        path, err = _validated(raw_path or str(_home()), must_exist=True)
        if path is None:
            return err
        if not path.is_dir():
            return f"{path} is not a folder."
        try:
            entries = sorted(path.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
        except Exception as exc:
            return f"Could not list {path}: {exc}"
        lines = []
        for entry in entries[:_MAX_LIST]:
            marker = "/" if entry.is_dir() else ""
            size = ""
            if entry.is_file():
                try:
                    size = f" ({entry.stat().st_size:,} bytes)"
                except Exception:
                    pass
            lines.append(f"{entry.name}{marker}{size}")
        more = f"\n(+{len(entries) - len(lines)} more)" if len(entries) > len(lines) else ""
        return f"Contents of {path}:\n" + "\n".join(lines) + more

    if action == "read":
        path, err = _validated(raw_path, must_exist=True)
        if path is None:
            return err
        if not path.is_file():
            return f"{path} is not a file."
        try:
            text = path.read_text(encoding="utf-8", errors="replace")[:_MAX_READ]
        except Exception as exc:
            return f"Could not read {path}: {exc}"
        return f"Contents of {path.name}:\n{text}"

    if action == "write":
        path, err = _validated(raw_path)
        if path is None:
            return err
        content = str(parameters.get("content") or "")
        append = bool(parameters.get("append"))
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            old_exists = path.is_file()
            old_text = path.read_text(encoding="utf-8", errors="replace") if old_exists else ""
            with open(path, "a" if append else "w", encoding="utf-8") as handle:
                handle.write(content)
            if append:
                undo.push(f"append to {path.name}", {
                    "type": "restore_file", "path": str(path), "content": old_text,
                })
            elif old_exists:
                undo.push(f"overwrite {path.name}", {
                    "type": "restore_file", "path": str(path), "content": old_text,
                })
            else:
                undo.push(f"create {path.name}", {"type": "remove", "path": str(path)})
            verb = "Appended to" if append else ("Updated" if old_exists else "Created")
            return f"{verb} {path}."
        except Exception as exc:
            return f"Could not write {path}: {exc}"

    if action == "mkdir":
        path, err = _validated(raw_path)
        if path is None:
            return err
        try:
            path.mkdir(parents=True, exist_ok=False)
            undo.push(f"create folder {path.name}", {"type": "rmdir", "path": str(path)})
            return f"Created folder {path}."
        except FileExistsError:
            return f"{path} already exists."
        except Exception as exc:
            return f"Could not create {path}: {exc}"

    if action == "move":
        src, err = _validated(parameters.get("src"), must_exist=True)
        if src is None:
            return err
        dst, err2 = _validated(parameters.get("dst"))
        if dst is None:
            return err2
        if dst.is_dir():
            dst = dst / src.name
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
            undo.push(f"move {src.name} → {dst.parent}", {
                "type": "move", "src": str(dst), "dst": str(src),
            })
            return f"Moved {src.name} to {dst}."
        except Exception as exc:
            return f"Could not move: {exc}"

    if action == "copy":
        src, err = _validated(parameters.get("src"), must_exist=True)
        if src is None:
            return err
        dst, err2 = _validated(parameters.get("dst"))
        if dst is None:
            return err2
        if dst.is_dir():
            dst = dst / src.name
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            if src.is_dir():
                shutil.copytree(str(src), str(dst))
            else:
                shutil.copy2(str(src), str(dst))
            undo.push(f"copy → {dst.name}", {"type": "remove", "path": str(dst)})
            return f"Copied {src.name} to {dst}."
        except Exception as exc:
            return f"Could not copy: {exc}"

    if action == "rename":
        path, err = _validated(raw_path, must_exist=True)
        if path is None:
            return err
        new_name = str(parameters.get("new_name") or "").strip()
        if not new_name or any(ch in new_name for ch in "\\/:*?\"<>|"):
            return "That is not a valid file name."
        dst = path.with_name(new_name)
        try:
            path.rename(dst)
            undo.push(f"rename {path.name} → {new_name}", {
                "type": "move", "src": str(dst), "dst": str(path),
            })
            return f"Renamed to {new_name}."
        except Exception as exc:
            return f"Could not rename: {exc}"

    if action == "delete":
        path, err = _validated(raw_path, must_exist=True)
        if path is None:
            return err
        if not confirm.request(f"Delete {path.name}", f"Move {path} to Pico's trash (undoable)?"):
            return f"I did not delete {path.name} — the confirmation was not clicked."
        try:
            trash = _trash_dir() / path.name
            shutil.move(str(path), str(trash))
            undo.push(f"delete {path.name}", {
                "type": "trash", "trash": str(trash), "orig": str(path),
            })
            return f"Deleted {path.name} (recoverable — say undo if that was a mistake)."
        except Exception as exc:
            return f"Could not delete: {exc}"

    if action == "exists":
        path, err = _validated(raw_path)
        if path is None:
            return err
        return f"{path} {'exists' if path.exists() else 'does not exist'}."

    return ("Unknown file action. Use list, read, write, mkdir, move, copy, "
            "rename, delete or exists.")


TOOL = {
    "name": "file_controller",
    "description": (
        "Work with files and folders: list, read, write, create folders, move, "
        "copy, rename, delete. Deleting asks for an on-screen confirmation and "
        "goes to a recoverable trash. Paths outside the user's home folder need "
        "confirmation too."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {
                "type": "STRING",
                "description": "list | read | write | mkdir | move | copy | rename | delete | exists",
            },
            "path": {"type": "STRING", "description": "Target path"},
            "content": {"type": "STRING", "description": "Content for write"},
            "append": {"type": "BOOLEAN", "description": "Append instead of overwrite"},
            "src": {"type": "STRING", "description": "Source path for move/copy"},
            "dst": {"type": "STRING", "description": "Destination path for move/copy"},
            "new_name": {"type": "STRING", "description": "New name for rename"},
        },
        "required": ["action"],
    },
    "ability": "file_controller",
    "handler": run,
}
