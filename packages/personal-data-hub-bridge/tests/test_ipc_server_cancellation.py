"""Concurrency and cancellation tests for the JSON-lines IPC dispatcher."""

from __future__ import annotations

import time
from concurrent.futures import Future, ThreadPoolExecutor
from threading import Event, Timer

import pytest

from forensics_bridge import ipc_server


def _wait_until(predicate, timeout: float = 1.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.005)
    raise AssertionError("condition was not met before timeout")


@pytest.fixture
def isolated_dispatcher(monkeypatch):
    executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ipc-test")
    emitted: list[dict] = []
    monkeypatch.setattr(ipc_server, "EXECUTOR", executor)
    monkeypatch.setattr(ipc_server, "_emit", emitted.append)
    with ipc_server._PENDING_LOCK:
        ipc_server.PENDING.clear()

    yield emitted

    with ipc_server._PENDING_LOCK:
        pending = list(ipc_server.PENDING.values())
        ipc_server.PENDING.clear()
    for request in pending:
        request.timeout_timer.cancel()
        request.cancel_event.set()
        request.future.cancel()
    executor.shutdown(wait=True)


def test_running_request_does_not_block_concurrent_ping_or_cancel(
    isolated_dispatcher,
    monkeypatch,
) -> None:
    started = Event()

    def cooperative_block(_params, progress, _chunk):
        started.set()
        while True:
            time.sleep(0.005)
            progress(0, 1, "waiting")

    monkeypatch.setitem(
        ipc_server.METHODS,
        "test.cooperative_block",
        cooperative_block,
    )

    started_at = time.monotonic()
    ipc_server._handle_request(
        {
            "id": "slow",
            "method": "test.cooperative_block",
            "timeout_ms": 10_000,
        }
    )
    assert time.monotonic() - started_at < 0.5
    assert started.wait(timeout=0.5)

    ipc_server._handle_request({"id": "ping", "method": "sidecar.ping"})
    _wait_until(
        lambda: any(
            frame["id"] == "ping" and frame["type"] == "result"
            for frame in isolated_dispatcher
        )
    )

    ipc_server._handle_request(
        {
            "id": "cancel",
            "method": "request.cancel",
            "params": {"id": "slow"},
        }
    )
    _wait_until(
        lambda: any(
            frame["id"] == "cancel" and frame["type"] == "result"
            for frame in isolated_dispatcher
        )
    )
    _wait_until(lambda: "slow" not in ipc_server.PENDING)

    slow_terminal = [
        frame
        for frame in isolated_dispatcher
        if frame["id"] == "slow" and frame["type"] in {"result", "error"}
    ]
    assert slow_terminal == [
        {
            "id": "slow",
            "type": "error",
            "error": {
                "code": "CANCELLED",
                "msg": "request cancelled",
                "retryable": False,
            },
        }
    ]
    cancel_result = next(
        frame["data"]
        for frame in isolated_dispatcher
        if frame["id"] == "cancel" and frame["type"] == "result"
    )
    assert cancel_result == {
        "cancelled": True,
        "target": "slow",
        "running": True,
        "cooperative": True,
    }

    # Give the worker's next progress callback time to observe the token. Its
    # late completion must not emit a second terminal frame.
    time.sleep(0.03)
    assert [
        frame
        for frame in isolated_dispatcher
        if frame["id"] == "slow" and frame["type"] in {"result", "error"}
    ] == slow_terminal


def test_timeout_suppresses_a_non_cooperative_late_result(
    isolated_dispatcher,
    monkeypatch,
) -> None:
    release = Event()

    def non_cooperative(_params, _progress, _chunk):
        release.wait(timeout=1)
        return {"tooLate": True}

    monkeypatch.setitem(
        ipc_server.METHODS,
        "test.non_cooperative",
        non_cooperative,
    )
    ipc_server._handle_request(
        {
            "id": "timed",
            "method": "test.non_cooperative",
            "timeout_ms": 20,
        }
    )

    _wait_until(
        lambda: any(
            frame["id"] == "timed"
            and frame["type"] == "error"
            and frame["error"]["code"] == "TIMEOUT"
            for frame in isolated_dispatcher
        )
    )
    release.set()
    time.sleep(0.03)

    assert not any(
        frame["id"] == "timed" and frame["type"] == "result"
        for frame in isolated_dispatcher
    )


def test_stale_timeout_does_not_cancel_a_reused_request_id(
    isolated_dispatcher,
) -> None:
    stale_future = Future()
    current_future = Future()
    current_timer = Timer(60, lambda: None)
    current = ipc_server._PendingRequest(
        future=current_future,
        cancel_event=Event(),
        timeout_timer=current_timer,
    )
    with ipc_server._PENDING_LOCK:
        ipc_server.PENDING["reused"] = current

    ipc_server._timeout_request("reused", stale_future, 20)

    with ipc_server._PENDING_LOCK:
        assert ipc_server.PENDING["reused"] is current
    assert current.cancel_event.is_set() is False
    assert current_future.cancelled() is False
    assert isolated_dispatcher == []
