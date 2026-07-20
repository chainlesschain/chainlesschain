import { describe, it, expect } from "vitest";
import {
  IPC_PREFIX,
  encodeIpcMessage,
  decodeIpcLine,
  parseIpcBuffer,
  normalizeAnswer,
} from "../src/lib/ipc-attach-protocol.js";

describe("ipc-attach-protocol", () => {
  describe("encodeIpcMessage", () => {
    it("produces a line with __IPC__: prefix and trailing newline", () => {
      const out = encodeIpcMessage("HELLO", { sessionId: "abc" });
      expect(out.startsWith(IPC_PREFIX)).toBe(true);
      expect(out.endsWith("\n")).toBe(true);
    });

    it("round-trips through decodeIpcLine for simple payloads", () => {
      const enc = encodeIpcMessage("QUESTION", {
        qid: "q1",
        text: "Continue?",
      });
      const line = enc.trimEnd();
      const dec = decodeIpcLine(line);
      expect(dec.type).toBe("QUESTION");
      expect(dec.qid).toBe("q1");
      expect(dec.text).toBe("Continue?");
    });

    it("escapes newlines inside payload so they do not break framing", () => {
      const enc = encodeIpcMessage("ANSWER", { text: "line1\nline2\rline3" });
      // encoded form must contain no literal \n or \r in the JSON body
      const body = enc.slice(IPC_PREFIX.length, -1);
      expect(body.includes("\n")).toBe(false);
      expect(body.includes("\r")).toBe(false);
      const dec = decodeIpcLine(IPC_PREFIX + body);
      expect(dec.text).toBe("line1\nline2\rline3");
    });
  });

  describe("decodeIpcLine", () => {
    it("returns null for non-IPC lines", () => {
      expect(decodeIpcLine("ordinary log line")).toBeNull();
      expect(decodeIpcLine("")).toBeNull();
      expect(decodeIpcLine(null)).toBeNull();
    });

    it("returns PARSE_ERROR for malformed JSON after prefix", () => {
      const dec = decodeIpcLine(IPC_PREFIX + "{not-json");
      expect(dec.type).toBe("PARSE_ERROR");
    });
  });

  describe("parseIpcBuffer", () => {
    it("extracts complete messages and preserves partial trailing data", () => {
      const buf =
        encodeIpcMessage("HELLO", { v: 1 }) +
        "some plain stdout\n" +
        encodeIpcMessage("QUESTION", { qid: "q1" }) +
        "partial";
      const { messages, rest } = parseIpcBuffer(buf);
      expect(messages).toHaveLength(2);
      expect(messages[0].type).toBe("HELLO");
      expect(messages[1].type).toBe("QUESTION");
      expect(rest).toBe("partial");
    });

    it("returns empty messages and the whole buffer when no newline present", () => {
      const { messages, rest } = parseIpcBuffer(IPC_PREFIX + '{"type":"X"');
      expect(messages).toHaveLength(0);
      expect(rest).toBe(IPC_PREFIX + '{"type":"X"');
    });
  });

  describe("normalizeAnswer", () => {
    it("trims and returns raw strings", () => {
      expect(normalizeAnswer("  yes  ")).toBe("yes");
    });

    it("resolves 1-based option index to option value", () => {
      const q = { options: [{ value: "a" }, { value: "b" }, { value: "c" }] };
      expect(normalizeAnswer("2", q)).toBe("b");
    });

    it("returns raw string when index out of range", () => {
      const q = { options: [{ value: "a" }] };
      expect(normalizeAnswer("9", q)).toBe("9");
    });

    it("JSON-stringifies non-string values", () => {
      expect(normalizeAnswer({ foo: "bar" })).toBe('{"foo":"bar"}');
    });

    it("returns empty string for null/undefined", () => {
      expect(normalizeAnswer(null)).toBe("");
      expect(normalizeAnswer(undefined)).toBe("");
    });
  });
});
