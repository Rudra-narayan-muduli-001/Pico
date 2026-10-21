"""Open applications by name: alias table → App Paths registry → ShellExecute."""

from __future__ import annotations

import shutil

from winplat import windows

_ALIASES = {
    "notepad": "notepad.exe",
    "calculator": "calc.exe",
    "calc": "calc.exe",
    "paint": "mspaint.exe",
    "cmd": "cmd.exe",
    "command prompt": "cmd.exe",
    "terminal": "wt.exe",
    "windows terminal": "wt.exe",
    "powershell": "powershell.exe",
    "explorer": "explorer.exe",
    "file explorer": "explorer.exe",
    "task manager": "taskmgr.exe",
    "settings": "ms-settings:",
    "windows settings": "ms-settings:",
    "camera": "microsoft.windows.camera:",
    "store": "ms-windows-store:",
    "spotify": "spotify:",
    "chrome": "chrome.exe",
    "google chrome": "chrome.exe",
    "edge": "msedge.exe",
    "firefox": "firefox.exe",
    "word": "winword.exe",
    "excel": "excel.exe",
    "powerpoint": "powerpnt.exe",
    "outlook": "outlook.exe",
    "vs code": "code",
    "vscode": "code",
    "code": "code",
    "discord": "discord.exe",
    "obs": "obs64.exe",
    "steam": "steam.exe",
    "unity": "unity.exe",
    "snipping tool": "snippingtool.exe",
    "paint 3d": "ms-paint:",
    "photos": "ms-photos:",
    "mail": "outlookmail:",
    "calendar": "outlookcal:",
    "whatsapp": "whatsapp:",
}


def _app_paths_lookup(exe_name: str) -> str | None:
    """HKLM/HKCU 'App Paths' — how the shell resolves PATH-less app names."""
    try:
        import winreg
    except Exception:
        return None
    names = [exe_name]
    if not exe_name.lower().endswith(".exe"):
        names.append(exe_name + ".exe")
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for name in names:
            key_path = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths" + "\\" + name
            try:
                with winreg.OpenKey(hive, key_path) as key:
                    value, _ = winreg.QueryValueEx(key, "")
                    if value:
                        return str(value)
            except OSError:
                continue
    return None


def resolve(app: str) -> str | None:
    name = str(app or "").strip().lower()
    if not name:
        return None
    alias = _ALIASES.get(name)
    if alias:
        return alias
    if any(name.endswith(ext) for ext in (".exe", ".bat", ".cmd", ".lnk")):
        return app
    if any(sep in name for sep in ("\\", "/")):
        return app
    found = shutil.which(name) or shutil.which(name + ".exe")
    if found:
        return found
    return _app_paths_lookup(name) or name


def run(parameters: dict, ctx: dict) -> str:
    app = str(parameters.get("app") or parameters.get("name") or "").strip()
    if not app:
        return "Which app should I open?"
    target = resolve(app) or app
    result = windows.open_path(target)
    services = ctx.get("services")
    if services is not None and result.startswith("Opened"):
        try:
            services.note_app(app)
        except Exception:
            pass
    return result


TOOL = {
    "name": "open_app",
    "description": (
        "Open an application, file, folder or app protocol on this PC, by name "
        "(e.g. 'notepad', 'spotify', 'chrome', 'settings', or a full path). "
        "Use for 'open X' / 'launch X' requests."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "app": {"type": "STRING", "description": "App name or path to open"},
        },
        "required": ["app"],
    },
    "ability": "open_app",
    "handler": run,
}
