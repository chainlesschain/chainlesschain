/**
 * jsonrpc-stream tests — LSP Content-Length framing. Pure, no IO. Pins the
 * split-chunk / multi-message / multibyte-length / lenient-LF edge cases that a
 * naive framer gets wrong.
 */

import { describe, it, expect } from "vitest";
import {
  encodeMessage,
  parseContentLength,
  MessageBuffer,
} from "../jsonrpc-stream.js";

describe("encodeMessage", () => {
  it("frames a message with a byte-accurate Content-Length", () => {
    const buf = encodeMessage({ jsonrpc: "2.0", id: 1, method: "ping" });
    const text = buf.toString("utf8");
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(text).toBe(
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
  });

  it("counts BYTES not characters for multibyte content", () => {
    const buf = encodeMessage({ text: "你好" }); // 6 UTF-8 bytes for the two chars
    const headerLen = Number(
      /Content-Length: (\d+)/.exec(buf.toString("utf8"))[1],
    );
    const body = JSON.stringify({ text: "你好" });
    expect(headerLen).toBe(Buffer.byteLength(body, "utf8"));
    // round-trips through the buffer intact
    const mb = new MessageBuffer().append(buf);
    expect(mb.read()).toEqual({ text: "你好" });
  });
});

describe("parseContentLength", () => {
  it("reads the header case-insensitively", () => {
    expect(parseContentLength("content-length: 42")).toBe(42);
    expect(parseContentLength("Content-Length:   7\r\nContent-Type: x")).toBe(
      7,
    );
  });
  it("returns null when absent or invalid", () => {
    expect(parseContentLength("Content-Type: application/json")).toBeNull();
    expect(parseContentLength("Content-Length: abc")).toBeNull();
  });
});

describe("MessageBuffer", () => {
  it("decodes a single framed message", () => {
    const mb = new MessageBuffer();
    mb.append(encodeMessage({ id: 1, result: "ok" }));
    expect(mb.read()).toEqual({ id: 1, result: "ok" });
    expect(mb.read()).toBeNull();
  });

  it("decodes multiple messages in one chunk", () => {
    const mb = new MessageBuffer();
    const chunk = Buffer.concat([
      encodeMessage({ id: 1 }),
      encodeMessage({ id: 2 }),
      encodeMessage({ id: 3 }),
    ]);
    mb.append(chunk);
    expect(mb.readAll().map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it("reassembles a message split across chunks (header and body)", () => {
    const full = encodeMessage({ id: 7, method: "textDocument/definition" });
    const mb = new MessageBuffer();
    // split mid-header and mid-body
    for (let i = 0; i < full.length; i += 5) {
      mb.append(full.slice(i, i + 5));
    }
    expect(mb.read()).toEqual({ id: 7, method: "textDocument/definition" });
    expect(mb.hasPartial).toBe(false);
  });

  it("retains a partial frame until the rest arrives", () => {
    const full = encodeMessage({ id: 9 });
    const mb = new MessageBuffer();
    mb.append(full.slice(0, full.length - 3));
    expect(mb.read()).toBeNull();
    expect(mb.hasPartial).toBe(true);
    mb.append(full.slice(full.length - 3));
    expect(mb.read()).toEqual({ id: 9 });
  });

  it("tolerates LF-only header separators", () => {
    const body = JSON.stringify({ id: 5 });
    const mb = new MessageBuffer();
    mb.append(`Content-Length: ${body.length}\n\n${body}`);
    expect(mb.read()).toEqual({ id: 5 });
  });

  it("skips a body that isn't valid JSON but stays aligned for the next frame", () => {
    const mb = new MessageBuffer();
    const bad = "Content-Length: 3\r\n\r\n{{{";
    mb.append(bad + encodeMessage({ id: 2 }).toString("utf8"));
    // bad frame dropped, good one still decoded
    expect(mb.read()).toEqual({ id: 2 });
  });
});
