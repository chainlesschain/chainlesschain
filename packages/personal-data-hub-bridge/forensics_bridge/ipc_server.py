"""JSON-lines IPC server for forensics-bridge.

Reads one JSON request per line from stdin, dispatches to a method handler,
emits one or more JSON envelopes per request on stdout. Logs (pino-style)
go to stderr on a separate channel.

Envelope contract — see docs/design/Personal_Data_Hub_Python_Sidecar.md §3.

Run with:
    python -m forensics_bridge.ipc_server

The hub-side counterpart is `SidecarSupervisor` in
`packages/personal-data-hub/lib/sidecar/supervisor.js`.
"""

from __future__ import annotations

import io
import json
import sys
import time
import traceback
import uuid
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FuturesTimeout
from threading import Lock
from typing import Any, Dict

from .dispatcher import IpcError, METHODS, dispatch
# Importing parsers + extractors triggers @register() side-effects, populating METHODS.
# Add new namespaces here as sub-phases land them (system, wechat, alipay, ios, ...).
from .parsers import system as _system_parsers  # noqa: F401
from .extractors import android as _android_extractor  # noqa: F401

# Force UTF-8 on stdin/stdout — Windows defaults to cp936/GBK which mangles
# Chinese app data (rule: .claude/rules/encoding.md).
try:
    sys.stdin.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except AttributeError:  # pre-3.7 fallback (should not happen, requires-python>=3.11)
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


DEFAULT_TIMEOUT_MS = 60_000
EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="forensics-bridge")
PENDING: Dict[str, Future] = {}
_STDOUT_LOCK = Lock()


def _emit(envelope: dict) -> None:
    """Write one JSON envelope to stdout. Thread-safe."""
    line = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))
    with _STDOUT_LOCK:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def _log(level: str, msg: str, **fields: Any) -> None:
    """Emit a pino-style structured log line on stderr."""
    rec = {"ts": int(time.time() * 1000), "level": level, "msg": msg, **fields}
    sys.stderr.write(json.dumps(rec, ensure_ascii=False) + "\n")
    sys.stderr.flush()


def _emit_progress(req_id: str):
    def cb(processed: int, total: int, phase: str = "") -> None:
        _emit({
            "id": req_id,
            "type": "progress",
            "data": {"processed": processed, "total": total, "phase": phase},
        })

    return cb


def _emit_chunk(req_id: str):
    def cb(batch: dict) -> None:
        _emit({"id": req_id, "type": "chunk", "data": batch})

    return cb


def _emit_result(req_id: str, data: Any) -> None:
    _emit({"id": req_id, "type": "result", "data": data})
    PENDING.pop(req_id, None)


def _emit_error(req_id: str | None, code: str, message: str, retryable: bool = False) -> None:
    _emit({
        "id": req_id,
        "type": "error",
        "error": {"code": code, "msg": message, "retryable": retryable},
    })
    if req_id is not None:
        PENDING.pop(req_id, None)


def _handle_request(req: dict) -> None:
    """Dispatch one parsed request envelope."""
    req_id = req.get("id") or str(uuid.uuid4())
    method = req.get("method")
    params = req.get("params") or {}
    timeout_ms = req.get("timeout_ms") or DEFAULT_TIMEOUT_MS

    if not isinstance(method, str) or not method:
        _emit_error(req_id, "INVALID_PARAMS", "missing or invalid 'method' field")
        return

    # Cancel meta-method is handled inline — must not be queued behind the
    # executor (otherwise a busy executor blocks cancellation).
    if method == "request.cancel":
        target_id = (params.get("id") if isinstance(params, dict) else None)
        if not target_id:
            _emit_error(req_id, "INVALID_PARAMS", "request.cancel needs params.id")
            return
        fut = PENDING.get(target_id)
        cancelled = bool(fut and fut.cancel())
        _emit_result(req_id, {"cancelled": cancelled, "target": target_id})
        return

    if method not in METHODS:
        _emit_error(req_id, "METHOD_NOT_FOUND", f"unknown method: {method}")
        return

    progress_cb = _emit_progress(req_id)
    chunk_cb = _emit_chunk(req_id)

    fut = EXECUTOR.submit(dispatch, method, params, progress_cb, chunk_cb)
    PENDING[req_id] = fut

    try:
        result = fut.result(timeout=timeout_ms / 1000.0)
        _emit_result(req_id, result)
    except FuturesTimeout:
        # Best-effort cancel; Python threads cannot be force-killed.
        fut.cancel()
        _emit_error(req_id, "TIMEOUT", f"exceeded timeout_ms={timeout_ms}", retryable=True)
    except IpcError as exc:
        _emit_error(req_id, exc.code, exc.message, retryable=exc.retryable)
    except Exception as exc:  # pragma: no cover — last-resort guard
        _log("error", "method raised", method=method, exc=str(exc))
        _emit_error(
            req_id,
            "PARSER_INTERNAL",
            f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}",
        )


def main() -> int:
    """Entry point: read stdin lines forever until EOF."""
    _log("info", "forensics-bridge starting", methods=list(METHODS.keys()))
    try:
        for raw in sys.stdin:
            line = raw.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except json.JSONDecodeError as exc:
                _emit_error(None, "INVALID_JSON", str(exc))
                continue
            if not isinstance(req, dict):
                _emit_error(None, "INVALID_PARAMS", "envelope must be a JSON object")
                continue
            _handle_request(req)
    except KeyboardInterrupt:
        _log("info", "forensics-bridge interrupted")
    finally:
        EXECUTOR.shutdown(wait=False, cancel_futures=True)
        _log("info", "forensics-bridge exiting")
    return 0


if __name__ == "__main__":
    sys.exit(main())
