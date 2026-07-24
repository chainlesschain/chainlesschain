from __future__ import annotations

import json
import unittest

from chainlesschain_agent_sdk import NdjsonDecodeError, NdjsonDecoder, encode_ndjson


class NdjsonTests(unittest.TestCase):
    def test_reassembles_every_byte_boundary_and_split_utf8(self) -> None:
        payload = (
            '{"type":"raw","text":"你好"}\n'
            '{"type":"result","subtype":"success","is_error":false}'
        ).encode("utf-8")
        decoder = NdjsonDecoder()
        values = []
        for byte in payload:
            values.extend(decoder.feed(bytes((byte,))))
        values.extend(decoder.flush())
        self.assertEqual(
            values,
            [
                {"type": "raw", "text": "你好"},
                {"type": "result", "subtype": "success", "is_error": False},
            ],
        )

    def test_crlf_blank_lines_and_final_unterminated_line(self) -> None:
        decoder = NdjsonDecoder()
        values = decoder.feed('\r\n{"a":1}\r\n\n{"b":2}')
        values.extend(decoder.flush())
        self.assertEqual(values, [{"a": 1}, {"b": 2}])

    def test_error_callback_keeps_decoder_alive(self) -> None:
        errors = []
        decoder = NdjsonDecoder(on_error=errors.append)
        values = decoder.feed('not-json\n{"ok":true}\n')
        self.assertEqual(values, [{"ok": True}])
        self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], NdjsonDecodeError)
        self.assertEqual(errors[0].line_number, 1)

    def test_without_callback_decode_error_is_raised(self) -> None:
        decoder = NdjsonDecoder()
        with self.assertRaises(NdjsonDecodeError):
            decoder.feed("bad\n")

    def test_encode_is_compact_utf8_and_rejects_nan(self) -> None:
        payload = encode_ndjson({"type": "raw", "text": "你好"})
        self.assertEqual(
            json.loads(payload.decode("utf-8")),
            {"type": "raw", "text": "你好"},
        )
        self.assertTrue(payload.endswith(b"\n"))
        with self.assertRaises(ValueError):
            encode_ndjson({"value": float("nan")})


if __name__ == "__main__":
    unittest.main()
