"""Screenshot the screen and answer a question about it (mss + vision model)."""

from __future__ import annotations

import deps

_MAX_EDGE = 1920


def _grab(region: dict | None = None) -> bytes | None:
    mss_mod = deps.try_import("mss")
    if mss_mod is None:
        return None
    try:
        import io
        with mss_mod.mss() as grabber:
            monitor = None
            if region:
                monitor = {
                    "left": int(region.get("left", 0)),
                    "top": int(region.get("top", 0)),
                    "width": max(1, int(region.get("width", 1))),
                    "height": max(1, int(region.get("height", 1))),
                }
            shot = grabber.grab(monitor) if monitor else grabber.grab(grabber.monitors[0])
            png = shot.rgb
            try:
                from PIL import Image
                image = Image.frombytes("RGB", shot.size, png)
                if max(image.size) > _MAX_EDGE:
                    scale = _MAX_EDGE / max(image.size)
                    image = image.resize((int(image.width * scale), int(image.height * scale)))
                buf = io.BytesIO()
                image.save(buf, format="PNG")
                return buf.getvalue()
            except Exception:
                buf = io.BytesIO()
                shot.save(buf, format="png")
                return buf.getvalue()
    except Exception:
        return None


def run(parameters: dict, ctx: dict) -> str:
    question = str(parameters.get("question") or parameters.get("text") or
                   "What is on the screen right now? Answer briefly.").strip()
    region = parameters.get("region") if isinstance(parameters.get("region"), dict) else None

    if not deps.try_import("mss"):
        text = deps.missing_text("mss", "screen reading")
        _toast(ctx, text)
        return text

    png = _grab(region)
    if png is None:
        return "I could not capture the screen."

    services = ctx.get("services")
    if services is None:
        return "Vision is not available right now."
    try:
        answer = services.vision(png, question)
    except Exception as exc:
        return f"Vision failed: {exc}"
    if not answer:
        return "I could not read anything from the screen."
    return answer


def _toast(ctx: dict, text: str) -> None:
    emit = ctx.get("emit")
    if callable(emit):
        emit({"dir": "ui", "type": "toast", "level": "warn", "text": text})


TOOL = {
    "name": "screen_processor",
    "description": (
        "Take a screenshot and answer a question about what is on the screen "
        "('what do you see', 'read the error on screen', 'what is this')."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "question": {"type": "STRING", "description": "What to answer about the screen"},
        },
        "required": [],
    },
    "ability": "screen_processor",
    "handler": run,
}
