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
from concurrent.futures import CancelledError as FutureCancelledError
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from threading import Event, Lock, Timer
from typing import Any, Dict

from .dispatcher import IpcError, METHODS, dispatch
# Importing parsers + extractors triggers @register() side-effects, populating METHODS.
# Add new namespaces here as sub-phases land them (system, wechat, alipay, ios, ...).
from .parsers import system as _system_parsers  # noqa: F401
from .extractors import android as _android_extractor  # noqa: F401
from .extractors import wechat_pc as _wechat_pc_extractor  # noqa: F401
from .extractors import qq_nt as _qq_nt_extractor  # noqa: F401

# Force UTF-8 on real process streams. Test runners replace these streams with
# capture wrappers; reconfiguring a wrapper can close its backing temporary file.
for _stream_name in ("stdin", "stdout", "stderr"):
    _stream = getattr(sys, _stream_name)
    _original_stream = getattr(sys, f"__{_stream_name}__")
    if _stream is not _original_stream:
        continue
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except AttributeError:  # pragma: no cover - requires-python is >=3.11
        setattr(
            sys,
            _stream_name,
            io.TextIOWrapper(_stream.buffer, encoding="utf-8"),
        )


DEFAULT_TIMEOUT_MS = 60_000
EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="forensics-bridge")
_STDOUT_LOCK = Lock()
_PENDING_LOCK = Lock()


class _RequestCancelled(Exception):
    """Internal cooperative-cancellation signal raised at callback boundaries."""


@dataclass
class _PendingRequest:
    future: Future
    cancel_event: Event
    timeout_timer: Timer


PENDING: Dict[str, _PendingRequest] = {}


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


def _emit_progress(req_id: str, cancel_event: Event):
    def cb(processed: int, total: int, phase: str = "") -> None:
        with _PENDING_LOCK:
            if cancel_event.is_set():
                raise _RequestCancelled()
            _emit({
                "id": req_id,
                "type": "progress",
                "data": {"processed": processed, "total": total, "phase": phase},
            })

    return cb


def _emit_chunk(req_id: str, cancel_event: Event):
    def cb(batch: dict) -> None:
        with _PENDING_LOCK:
            if cancel_event.is_set():
                raise _RequestCancelled()
            _emit({"id": req_id, "type": "chunk", "data": batch})

    return cb


def _emit_result(req_id: str, data: Any) -> None:
    _emit({"id": req_id, "type": "result", "data": data})


def _emit_error(req_id: str | None, code: str, message: str, retryable: bool = False) -> None:
    _emit({
        "id": req_id,
        "type": "error",
        "error": {"code": code, "msg": message, "retryable": retryable},
    })


def _take_pending(
    req_id: str,
    expected_future: Future | None = None,
    mark_cancelled: bool = False,
) -> _PendingRequest | None:
    """Atomically claim a pending request for exactly one terminal path."""
    with _PENDING_LOCK:
        pending = PENDING.get(req_id)
        if pending is None:
            return None
        if expected_future is not None and pending.future is not expected_future:
            return None
        if mark_cancelled:
            pending.cancel_event.set()
        PENDING.pop(req_id, None)
    pending.timeout_timer.cancel()
    return pending


def _complete_request(req_id: str, future: Future) -> None:
    """Future callback: emit one terminal envelope without blocking stdin."""
    pending = _take_pending(req_id, expected_future=future)
    if pending is None:
        # A timeout or request.cancel already emitted the terminal envelope.
        return
    try:
        result = future.result()
        _emit_result(req_id, result)
    except (FutureCancelledError, _RequestCancelled):
        _emit_error(req_id, "CANCELLED", "request cancelled")
    except IpcError as exc:
        _emit_error(req_id, exc.code, exc.message, retryable=exc.retryable)
    except Exception as exc:  # pragma: no cover - last-resort guard
        _log("error", "method raised", req_id=req_id, exc=str(exc))
        _emit_error(
            req_id,
            "PARSER_INTERNAL",
            f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}",
        )


def _timeout_request(
    req_id: str,
    expected_future: Future,
    timeout_ms: float,
) -> None:
    """Timer callback: logically cancel a request and suppress late results."""
    pending = _take_pending(
        req_id,
        expected_future=expected_future,
        mark_cancelled=True,
    )
    if pending is None:
        return
    pending.future.cancel()
    _emit_error(
        req_id,
        "TIMEOUT",
        f"exceeded timeout_ms={timeout_ms:g}",
        retryable=True,
    )


def _cancel_request(target_id: str) -> dict:
    """Cancel a queued task or mark a running thread for cooperative exit.

    Python cannot force-kill an individual ThreadPoolExecutor worker. Running
    handlers stop at their next progress/chunk callback; handlers that never
    call either callback may continue in the background, but their late output
    is discarded. A caller needing hard isolation can restart the sidecar.
    """
    pending = _take_pending(target_id, mark_cancelled=True)
    if pending is None:
        return {"cancelled": False, "target": target_id, "running": False}

    stopped_before_run = pending.future.cancel()
    was_running = not stopped_before_run and not pending.future.done()
    _emit_error(target_id, "CANCELLED", "request cancelled")
    return {
        "cancelled": True,
        "target": target_id,
        "running": was_running,
        "cooperative": was_running,
    }


def _cancel_all_pending() -> None:
    """Mark every in-flight task cancelled when the IPC peer disconnects."""
    with _PENDING_LOCK:
        pending = list(PENDING.values())
        PENDING.clear()
        for request in pending:
            request.cancel_event.set()
    for request in pending:
        request.timeout_timer.cancel()
        request.future.cancel()


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
        _emit_result(req_id, _cancel_request(target_id))
        return

    if method not in METHODS:
        _emit_error(req_id, "METHOD_NOT_FOUND", f"unknown method: {method}")
        return

    try:
        timeout_ms = float(timeout_ms)
        if timeout_ms <= 0:
            raise ValueError
    except (TypeError, ValueError):
        _emit_error(req_id, "INVALID_PARAMS", "timeout_ms must be a positive number")
        return
    with _PENDING_LOCK:
        if req_id in PENDING:
            _emit_error(req_id, "INVALID_PARAMS", f"duplicate request id: {req_id}")
            return

    cancel_event = Event()
    progress_cb = _emit_progress(req_id, cancel_event)
    chunk_cb = _emit_chunk(req_id, cancel_event)
    future = EXECUTOR.submit(dispatch, method, params, progress_cb, chunk_cb)
    timeout_timer = Timer(
        timeout_ms / 1000.0,
        _timeout_request,
        args=(req_id, future, timeout_ms),
    )
    timeout_timer.daemon = True
    pending = _PendingRequest(future, cancel_event, timeout_timer)
    with _PENDING_LOCK:
        PENDING[req_id] = pending
    timeout_timer.start()
    future.add_done_callback(lambda completed: _complete_request(req_id, completed))


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
        _cancel_all_pending()
        EXECUTOR.shutdown(wait=False, cancel_futures=True)
        _log("info", "forensics-bridge exiting")
    return 0


if __name__ == "__main__":
    sys.exit(main())
