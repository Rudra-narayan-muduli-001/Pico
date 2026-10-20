"""Copy this file, rename it (no leading underscore), fill in TOOL and run().
action_loader discovers it automatically — no other file changes.

The handler contract is ``run(parameters, ctx) -> str`` where ``ctx`` carries
``{"emit": <frame fn>, "services": <brain services>, "log": <fn>}``. Return a
short natural-language sentence: it is spoken back to the user and shown in the
transcript. Never raise out of a handler — return an error sentence instead.
"""

TOOL = {
    "name": "my_action",
    "description": (
        "One or two sentences the model uses to decide when to call this. Be "
        "explicit about trigger phrases."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "example_arg": {"type": "STRING", "description": "What this means"},
        },
        "required": [],
    },
    "ability": "my_action",
    "handler": None,
}


def run(parameters: dict, ctx: dict) -> str:
    example_arg = parameters.get("example_arg", "")
    try:
        return f"Did the thing with {example_arg}."
    except Exception as exc:
        return f"my_action failed: {exc}"


TOOL["handler"] = run
