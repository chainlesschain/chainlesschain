"""Unit tests for the dispatcher and built-in sidecar.* methods."""

from __future__ import annotations

import pytest

from forensics_bridge import __version__
from forensics_bridge.dispatcher import IpcError, METHODS, dispatch, register


def _noop_progress(*_args, **_kwargs) -> None:
    pass


def _noop_chunk(*_args, **_kwargs) -> None:
    pass


def test_ping_returns_version_and_python_info() -> None:
    result = dispatch("sidecar.ping", {}, _noop_progress, _noop_chunk)
    assert result["version"] == __version__
    assert result["pythonVersion"].startswith("3.")
    assert "platform" in result


def test_capabilities_lists_registered_methods() -> None:
    result = dispatch("sidecar.capabilities", {}, _noop_progress, _noop_chunk)
    assert "sidecar.ping" in result["methods"]
    assert "sidecar.capabilities" in result["methods"]
    assert result["version"] == __version__
    # Namespaces are derived from registered methods; lists are sorted.
    # As sub-phases register more, they show up here automatically.
    assert isinstance(result["parsers"], list)
    assert isinstance(result["extractors"], list)
    # Phase 4.5.2 always brings "system" parser online.
    assert "system" in result["parsers"]


def test_unknown_method_raises_typed_error() -> None:
    with pytest.raises(IpcError) as info:
        dispatch("nonexistent.method", {}, _noop_progress, _noop_chunk)
    assert info.value.code == "METHOD_NOT_FOUND"
    assert info.value.retryable is False


def test_register_rejects_duplicate_names() -> None:
    @register("test.duplicate_check")
    def _first(_p, _pr, _ch):  # pragma: no cover — registration only
        return {}

    try:
        with pytest.raises(RuntimeError, match="duplicate"):

            @register("test.duplicate_check")
            def _second(_p, _pr, _ch):  # pragma: no cover
                return {}
    finally:
        METHODS.pop("test.duplicate_check", None)


def test_progress_and_chunk_callbacks_are_invoked() -> None:
    progress_calls = []
    chunk_calls = []

    @register("test.stream_demo")
    def _stream(_params, emit_progress, emit_chunk):
        emit_progress(1, 2, "warming")
        emit_chunk({"events": [{"id": "evt-1"}]})
        emit_progress(2, 2, "done")
        return {"status": "ok", "totalEvents": 1}

    try:
        result = dispatch(
            "test.stream_demo",
            {},
            lambda p, t, ph="": progress_calls.append((p, t, ph)),
            lambda b: chunk_calls.append(b),
        )
        assert result == {"status": "ok", "totalEvents": 1}
        assert progress_calls == [(1, 2, "warming"), (2, 2, "done")]
        assert chunk_calls == [{"events": [{"id": "evt-1"}]}]
    finally:
        METHODS.pop("test.stream_demo", None)


def test_ipc_error_propagates_code_and_retryable() -> None:
    @register("test.raise_typed")
    def _raise(_params, _pr, _ch):
        raise IpcError("WECHAT_KEY_INVALID", "wrong key", retryable=False)

    try:
        with pytest.raises(IpcError) as info:
            dispatch("test.raise_typed", {}, _noop_progress, _noop_chunk)
        assert info.value.code == "WECHAT_KEY_INVALID"
        assert info.value.message == "wrong key"
        assert info.value.retryable is False
    finally:
        METHODS.pop("test.raise_typed", None)
