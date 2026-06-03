"""Method dispatcher for forensics-bridge IPC.

Each method is a callable: (params, emit_progress, emit_chunk) -> result_dict.
emit_progress(processed, total, phase="") and emit_chunk(batch) are optional;
short calls can ignore them and just return.

Adding a new method:
    1. Define a function with the signature above.
    2. Register it with @register("namespace.method_name").
    3. Add an entry to the capabilities table in `capabilities.py`.

Methods MUST raise IpcError for known failure modes (mapped to typed envelope
errors). Bare exceptions propagate as PARSER_INTERNAL.
"""

from __future__ import annotations

import platform
import sys
from typing import Any, Callable, Dict

from . import __version__


ProgressCb = Callable[[int, int, str], None]
ChunkCb = Callable[[dict], None]
MethodFn = Callable[[dict, ProgressCb, ChunkCb], dict]


class IpcError(Exception):
    """Raised by methods to signal a typed IPC error.

    Attributes:
        code: stable error code per Personal_Data_Hub_Python_Sidecar.md §3.3.
        message: human-readable detail.
        retryable: whether the hub should retry (bool).
    """

    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


METHODS: Dict[str, MethodFn] = {}


def register(name: str):
    """Decorator: register a method under the given name."""

    def wrap(fn: MethodFn) -> MethodFn:
        if name in METHODS:
            raise RuntimeError(f"duplicate method registration: {name}")
        METHODS[name] = fn
        return fn

    return wrap


def dispatch(
    method: str,
    params: dict,
    emit_progress: ProgressCb,
    emit_chunk: ChunkCb,
) -> dict:
    """Look up and invoke a method.

    Raises IpcError("METHOD_NOT_FOUND") for unknown methods.
    """
    fn = METHODS.get(method)
    if fn is None:
        raise IpcError("METHOD_NOT_FOUND", f"unknown method: {method}")
    return fn(params or {}, emit_progress, emit_chunk)


# ---------------------------------------------------------------------------
# Built-in methods: sidecar.*
# ---------------------------------------------------------------------------


@register("sidecar.ping")
def _ping(_params: dict, _progress: ProgressCb, _chunk: ChunkCb) -> dict:
    """Health check. Returns sidecar + Python versions."""
    return {
        "version": __version__,
        "pythonVersion": platform.python_version(),
        "platform": sys.platform,
    }


@register("sidecar.capabilities")
def _capabilities(_params: dict, _progress: ProgressCb, _chunk: ChunkCb) -> dict:
    """Declare which methods this sidecar build supports.

    Parsers/extractors are derived from the registered method namespaces —
    a method named "<ns>.<verb>" implies parser/extractor "<ns>".
    """
    parsers = set()
    extractors = set()
    for name in METHODS:
        if "." not in name:
            continue
        ns, _, _verb = name.partition(".")
        if ns in ("sidecar", "request"):
            continue
        if ns in ("android", "ios"):
            extractors.add(ns)
        else:
            parsers.add(ns)
    return {
        "version": __version__,
        "methods": sorted(METHODS.keys()),
        "parsers": sorted(parsers),
        "extractors": sorted(extractors),
    }
