"""Incremental newline-delimited JSON framing."""

from __future__ import annotations

import codecs
import json
from dataclasses import asdict, is_dataclass
from typing import Any, Callable, List, Optional, Union


class NdjsonDecodeError(ValueError):
    """A malformed UTF-8 or JSON protocol line."""

    def __init__(self, message: str, *, line_number: int, line: str = "") -> None:
        super().__init__(message)
        self.line_number = line_number
        self.line = line


ErrorCallback = Callable[[NdjsonDecodeError], None]


class NdjsonDecoder:
    """Carry-buffer NDJSON decoder.

    ``feed`` accepts arbitrarily split bytes (including a split UTF-8 code
    point) or text. Blank lines are ignored. ``flush`` parses the final
    unterminated line so process exit cannot silently lose an event.
    """

    def __init__(
        self,
        *,
        on_error: Optional[ErrorCallback] = None,
        max_line_chars: int = 4 * 1024 * 1024,
    ) -> None:
        if max_line_chars <= 0:
            raise ValueError("max_line_chars must be positive")
        self._on_error = on_error
        self._max_line_chars = max_line_chars
        self._buffer = ""
        self._line_number = 0
        self._utf8 = codecs.getincrementaldecoder("utf-8")("strict")

    def feed(self, chunk: Union[bytes, bytearray, memoryview, str]) -> List[Any]:
        if isinstance(chunk, str):
            text = chunk
        elif isinstance(chunk, (bytes, bytearray, memoryview)):
            try:
                text = self._utf8.decode(bytes(chunk), final=False)
            except UnicodeDecodeError as exc:
                self._report(
                    NdjsonDecodeError(
                        f"invalid UTF-8 in NDJSON stream: {exc}",
                        line_number=self._line_number + 1,
                    )
                )
                self._utf8.reset()
                return []
        else:
            raise TypeError("NDJSON chunk must be bytes or str")

        self._buffer += text
        values: List[Any] = []
        while True:
            newline = self._buffer.find("\n")
            if newline < 0:
                break
            line = self._buffer[:newline]
            self._buffer = self._buffer[newline + 1 :]
            self._line_number += 1
            value = self._decode_line(line)
            if value is not _MISSING:
                values.append(value)

        if len(self._buffer) > self._max_line_chars:
            bad = self._buffer
            self._buffer = ""
            self._report(
                NdjsonDecodeError(
                    f"NDJSON line exceeds {self._max_line_chars} characters",
                    line_number=self._line_number + 1,
                    line=bad,
                )
            )
        return values

    def flush(self) -> List[Any]:
        values: List[Any] = []
        try:
            tail = self._utf8.decode(b"", final=True)
        except UnicodeDecodeError as exc:
            self._report(
                NdjsonDecodeError(
                    f"incomplete UTF-8 at end of NDJSON stream: {exc}",
                    line_number=self._line_number + 1,
                )
            )
            tail = ""
        finally:
            self._utf8.reset()
        self._buffer += tail
        if self._buffer:
            line = self._buffer
            self._buffer = ""
            self._line_number += 1
            value = self._decode_line(line)
            if value is not _MISSING:
                values.append(value)
        return values

    def _decode_line(self, line: str) -> Any:
        if line.endswith("\r"):
            line = line[:-1]
        if not line.strip():
            return _MISSING
        if len(line) > self._max_line_chars:
            self._report(
                NdjsonDecodeError(
                    f"NDJSON line exceeds {self._max_line_chars} characters",
                    line_number=self._line_number,
                    line=line,
                )
            )
            return _MISSING
        try:
            return json.loads(line)
        except json.JSONDecodeError as exc:
            self._report(
                NdjsonDecodeError(
                    f"invalid JSON on NDJSON line {self._line_number}: {exc.msg}",
                    line_number=self._line_number,
                    line=line,
                )
            )
            return _MISSING

    def _report(self, error: NdjsonDecodeError) -> None:
        if self._on_error is not None:
            self._on_error(error)
            return
        raise error


_MISSING = object()


def encode_ndjson(value: Any) -> bytes:
    """Encode one compact UTF-8 JSON object followed by ``\n``."""

    if hasattr(value, "to_dict"):
        value = value.to_dict()
    elif is_dataclass(value):
        value = asdict(value)
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")
