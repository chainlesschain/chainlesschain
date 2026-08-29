from __future__ import annotations

import json
import sys


def emit(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
    sys.stdout.flush()


for line in sys.stdin:
    request = json.loads(line)
    method = request.get("method")
    if method == "initialize":
        emit(
            {
                "jsonrpc": "2.0",
                "id": request["id"],
                "result": {
                    "protocolVersion": 1,
                    "features": ["context_memory_kernel"],
                },
            }
        )
        emit(
            {
                "jsonrpc": "2.0",
                "method": "context/event",
                "params": {"type": "context.plan.created"},
            }
        )
    else:
        emit(
            {
                "jsonrpc": "2.0",
                "id": request["id"],
                "result": {"method": method, "params": request.get("params", {})},
            }
        )
