import { describe, expect, it, vi } from "vitest";

import { createNdjsonDecoder, encodeNdjson } from "../src/ndjson.js";

describe("createNdjsonDecoder", () => {
  it("parses one message per line", () => {
    const seen: unknown[] = [];
    const decode = createNdjsonDecoder((m) => seen.push(m));
    decode('{"a":1}\n{"b":2}\n');
    expect(seen).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("carries a split line across chunk boundaries", () => {
    const seen: unknown[] = [];
    const decode = createNdjsonDecoder((m) => seen.push(m));
    decode('{"type":"stream_event","ev');
    expect(seen).toEqual([]);
    decode('ent":{"x":1}}\n');
    expect(seen).toEqual([{ type: "stream_event", event: { x: 1 } }]);
  });

  it("handles CRLF and blank lines", () => {
    const seen: unknown[] = [];
    const decode = createNdjsonDecoder((m) => seen.push(m));
    decode('{"a":1}\r\n\r\n  \n{"b":2}\r\n');
    expect(seen).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("reports bad JSON lines without dropping later ones", () => {
    const seen: unknown[] = [];
    const errors: string[] = [];
    const decode = createNdjsonDecoder((m) => seen.push(m), {
      onError: (_e, line) => errors.push(line ?? ""),
    });
    decode('not-json\n{"ok":true}\n');
    expect(seen).toEqual([{ ok: true }]);
    expect(errors).toEqual(["not-json"]);
  });

  it("resets and errors when a line exceeds maxLineLength", () => {
    const onError = vi.fn();
    const seen: unknown[] = [];
    const decode = createNdjsonDecoder((m) => seen.push(m), {
      maxLineLength: 16,
      onError,
    });
    decode('"aaaaaaaaaaaaaaaaaaaaaaaaaaaa"');
    expect(onError).toHaveBeenCalledTimes(1);
    decode('{"ok":1}\n');
    expect(seen).toEqual([{ ok: 1 }]);
  });

  it("decodes Uint8Array chunks, including a multi-byte char split across chunks", () => {
    const seen: unknown[] = [];
    const decode = createNdjsonDecoder((m) => seen.push(m));
    const full = new TextEncoder().encode('{"t":"中文"}\n');
    // Split inside the UTF-8 sequence of 中 (3 bytes starting at index 6).
    decode(full.slice(0, 7));
    decode(full.slice(7));
    expect(seen).toEqual([{ t: "中文" }]);
  });
});

describe("encodeNdjson", () => {
  it("appends exactly one newline", () => {
    expect(encodeNdjson({ type: "user", text: "hi" })).toBe(
      '{"type":"user","text":"hi"}\n',
    );
  });
});

describe("flush", () => {
  it("emits a final unterminated line on flush", () => {
    const seen: unknown[] = [];
    const decode = createNdjsonDecoder((m) => seen.push(m));
    decode('{"type":"result","is_error":true}');
    expect(seen).toEqual([]);
    decode.flush();
    expect(seen).toEqual([{ type: "result", is_error: true }]);
    decode.flush(); // idempotent — nothing buffered
    expect(seen).toHaveLength(1);
  });

  it("flush reports (not throws) on a partial JSON remainder", () => {
    const errors: string[] = [];
    const decode = createNdjsonDecoder(() => {}, {
      onError: (_e, line) => errors.push(line ?? ""),
    });
    decode('{"half":');
    decode.flush();
    expect(errors).toEqual(['{"half":']);
  });
});
