"""Hermetic stand-in for ``cc`` used by subprocess session tests."""

from __future__ import annotations

import json
import os
import sys


def emit(value, *, newline=True):
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write(text + ("\n" if newline else ""))
    sys.stdout.flush()


emit(
    {
        "type": "system",
        "subtype": "init",
        "session_id": "fake-session",
        "argv": sys.argv[1:],
        "interactive_questions": os.environ.get("CC_INTERACTIVE_QUESTIONS"),
    }
)
emit({"type": "future_agent_event", "payload": {"kept": True}, "seq": 2})
print("fake stderr trace", file=sys.stderr, flush=True)

if "--fake-exit-no-result" in sys.argv:
    raise SystemExit(3)

responses = []
for line in sys.stdin:
    event = json.loads(line)
    responses.append(event)
    event_type = event.get("type")
    if event_type == "user":
        emit(
            {
                "type": "approval_request",
                "id": "approval-1",
                "tool": "run_shell",
                "command": "python -m unittest",
                "risk": "medium",
                "rule": None,
                "reason": "test callback",
            }
        )
    elif event_type == "approval":
        emit(
            {
                "type": "question_request",
                "id": "question-1",
                "question": "Choose?",
                "options": ["a", "b"],
            }
        )
    elif event_type == "answer" and event.get("id") == "question-1":
        emit(
            {
                "type": "question_request",
                "id": "mcp-1",
                "question": "Configure MCP?",
                "metadata": {
                    "kind": "mcp_elicitation",
                    "server": "fake",
                    "requestedSchema": {"type": "object"},
                },
            }
        )
    elif event_type == "answer" and event.get("id") == "mcp-1":
        # No newline exercises decoder.flush() after the child exits.
        emit(
            {
                "type": "result",
                "subtype": "success",
                "is_error": False,
                "result": json.dumps(responses, separators=(",", ":")),
                "session_id": "fake-session",
            },
            newline=False,
        )
        raise SystemExit(0)
