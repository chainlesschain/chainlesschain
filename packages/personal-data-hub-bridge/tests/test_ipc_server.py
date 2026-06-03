"""End-to-end test: spawn the sidecar as a subprocess and exchange envelopes."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest


SIDECAR_ROOT = Path(__file__).resolve().parents[1]


def _spawn_sidecar() -> subprocess.Popen:
    """Spawn the sidecar with stdin/stdout pipes wired for JSON-lines."""
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    # Ensure the sidecar's parent module is importable when running tests in-tree.
    env["PYTHONPATH"] = str(SIDECAR_ROOT) + os.pathsep + env.get("PYTHONPATH", "")
    return subprocess.Popen(
        [sys.executable, "-u", "-m", "forensics_bridge.ipc_server"],
        cwd=str(SIDECAR_ROOT),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        text=True,
        encoding="utf-8",
        bufsize=1,  # line-buffered
    )


def _send(proc: subprocess.Popen, envelope: dict) -> None:
    assert proc.stdin is not None
    proc.stdin.write(json.dumps(envelope) + "\n")
    proc.stdin.flush()


def _recv(proc: subprocess.Popen, timeout: float = 5.0) -> dict:
    """Read one stdout line as JSON. Raises on timeout."""
    assert proc.stdout is not None
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            time.sleep(0.01)
            continue
        return json.loads(line)
    raise TimeoutError(f"sidecar did not respond within {timeout}s")


@pytest.fixture
def sidecar():
    proc = _spawn_sidecar()
    try:
        yield proc
    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=2)


def test_sidecar_ping_round_trip(sidecar) -> None:
    _send(sidecar, {"id": "req-1", "method": "sidecar.ping", "params": {}})
    env = _recv(sidecar)
    assert env["id"] == "req-1"
    assert env["type"] == "result"
    assert env["data"]["version"]
    assert env["data"]["pythonVersion"].startswith("3.")


def test_sidecar_capabilities_envelope(sidecar) -> None:
    _send(sidecar, {"id": "req-2", "method": "sidecar.capabilities", "params": {}})
    env = _recv(sidecar)
    assert env["type"] == "result"
    assert "sidecar.ping" in env["data"]["methods"]
    assert "sidecar.capabilities" in env["data"]["methods"]


def test_unknown_method_returns_typed_error(sidecar) -> None:
    _send(sidecar, {"id": "req-3", "method": "does.not.exist", "params": {}})
    env = _recv(sidecar)
    assert env["type"] == "error"
    assert env["error"]["code"] == "METHOD_NOT_FOUND"
    assert env["error"]["retryable"] is False


def test_invalid_json_does_not_crash(sidecar) -> None:
    assert sidecar.stdin is not None
    sidecar.stdin.write("{not valid json\n")
    sidecar.stdin.flush()
    env = _recv(sidecar)
    assert env["type"] == "error"
    assert env["error"]["code"] == "INVALID_JSON"
    # Subsequent request should still work.
    _send(sidecar, {"id": "req-4", "method": "sidecar.ping", "params": {}})
    env2 = _recv(sidecar)
    assert env2["id"] == "req-4"
    assert env2["type"] == "result"


def test_two_sequential_requests_share_one_process(sidecar) -> None:
    _send(sidecar, {"id": "req-a", "method": "sidecar.ping", "params": {}})
    env_a = _recv(sidecar)
    _send(sidecar, {"id": "req-b", "method": "sidecar.capabilities", "params": {}})
    env_b = _recv(sidecar)
    assert env_a["id"] == "req-a" and env_b["id"] == "req-b"
    assert env_a["type"] == env_b["type"] == "result"


def test_missing_method_field_returns_error(sidecar) -> None:
    _send(sidecar, {"id": "req-5", "params": {}})
    env = _recv(sidecar)
    assert env["type"] == "error"
    assert env["error"]["code"] == "INVALID_PARAMS"
