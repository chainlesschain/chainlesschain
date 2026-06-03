import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAvailable,
  sendChat,
  sendChatStream,
  streamAvailable,
  toBridgeMessages,
  __testing,
  type BridgeResult,
  type StreamChunkPayload,
} from "../llm-preview-bridge";

function expectFailure(
  r: BridgeResult,
): asserts r is { ok: false; reason: string } {
  if (r.ok) throw new Error("expected failure, got success");
}

interface MockLlm {
  checkStatus: ReturnType<typeof vi.fn>;
  chat: ReturnType<typeof vi.fn>;
  queryStream?: ReturnType<typeof vi.fn>;
  on?: ReturnType<typeof vi.fn>;
  off?: ReturnType<typeof vi.fn>;
}

function installMockLlm(mock: Partial<MockLlm>): MockLlm {
  const full: MockLlm = {
    checkStatus: mock.checkStatus ?? vi.fn(),
    chat: mock.chat ?? vi.fn(),
    ...(mock.queryStream ? { queryStream: mock.queryStream } : {}),
    ...(mock.on ? { on: mock.on } : {}),
    ...(mock.off ? { off: mock.off } : {}),
  };
  (window as unknown as { electronAPI: { llm: MockLlm } }).electronAPI = {
    llm: full,
  };
  return full;
}

function clearMockLlm() {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
}

describe("llm-preview-bridge", () => {
  beforeEach(() => {
    clearMockLlm();
  });
  afterEach(() => {
    clearMockLlm();
  });

  describe("isAvailable()", () => {
    it("returns false when electronAPI missing", async () => {
      expect(await isAvailable()).toBe(false);
    });

    it("accepts { available: true } shape", async () => {
      installMockLlm({
        checkStatus: vi.fn().mockResolvedValue({ available: true }),
      });
      expect(await isAvailable()).toBe(true);
    });

    it("accepts plain boolean shape", async () => {
      installMockLlm({ checkStatus: vi.fn().mockResolvedValue(true) });
      expect(await isAvailable()).toBe(true);
    });

    it("returns false when { available: false }", async () => {
      installMockLlm({
        checkStatus: vi
          .fn()
          .mockResolvedValue({ available: false, error: "no provider" }),
      });
      expect(await isAvailable()).toBe(false);
    });

    it("returns false when checkStatus rejects", async () => {
      installMockLlm({
        checkStatus: vi.fn().mockRejectedValue(new Error("boom")),
      });
      expect(await isAvailable()).toBe(false);
    });
  });

  describe("sendChat()", () => {
    it("returns ok with reply from { content }", async () => {
      installMockLlm({
        chat: vi.fn().mockResolvedValue({ content: "hello back" }),
      });
      const r = await sendChat([{ role: "user", content: "hi" }]);
      expect(r).toEqual({ ok: true, reply: "hello back" });
    });

    it("reads reply from { message: { content } }", async () => {
      installMockLlm({
        chat: vi.fn().mockResolvedValue({ message: { content: "nested" } }),
      });
      const r = await sendChat([{ role: "user", content: "hi" }]);
      expect(r).toEqual({ ok: true, reply: "nested" });
    });

    it("returns error when reply is empty", async () => {
      installMockLlm({ chat: vi.fn().mockResolvedValue({ content: "" }) });
      const r = await sendChat([{ role: "user", content: "hi" }]);
      expectFailure(r);
      expect(r.reason).toMatch(/空/);
    });

    it("catches thrown errors", async () => {
      installMockLlm({
        chat: vi.fn().mockRejectedValue(new Error("upstream down")),
      });
      const r = await sendChat([{ role: "user", content: "hi" }]);
      expect(r).toEqual({ ok: false, reason: "upstream down" });
    });

    it("returns error when electronAPI is missing", async () => {
      const r = await sendChat([{ role: "user", content: "hi" }]);
      expectFailure(r);
      expect(r.reason).toMatch(/electronAPI/);
    });

    it("passes messages through and disables advanced flags", async () => {
      const chatMock = vi.fn().mockResolvedValue({ content: "ok" });
      installMockLlm({ chat: chatMock });
      await sendChat([
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
      ]);
      const call = chatMock.mock.calls[0][0];
      expect(call.messages).toHaveLength(2);
      expect(call.enableRAG).toBe(false);
      expect(call.enableCache).toBe(false);
      expect(call.enableMultiAgent).toBe(false);
    });
  });

  describe("toBridgeMessages()", () => {
    const history = [
      {
        id: "m1",
        role: "user" as const,
        content: "q",
        createdAt: 1,
      },
      {
        id: "m2",
        role: "assistant" as const,
        content: "a",
        createdAt: 2,
      },
    ];

    it("maps history to bridge shape and appends next user message", () => {
      const out = toBridgeMessages(history, "next");
      expect(out).toEqual([
        { role: "user", content: "q" },
        { role: "assistant", content: "a" },
        { role: "user", content: "next" },
      ]);
    });

    it("skips append when next is empty/whitespace", () => {
      expect(toBridgeMessages(history, "   ")).toHaveLength(2);
      expect(toBridgeMessages(history)).toHaveLength(2);
    });

    it("trims the appended next message", () => {
      const out = toBridgeMessages([], "  padded  ");
      expect(out).toEqual([{ role: "user", content: "padded" }]);
    });
  });

  describe("extractReply()", () => {
    const { extractReply } = __testing;

    it("prefers top-level content", () => {
      expect(extractReply({ content: "a", message: { content: "b" } })).toBe(
        "a",
      );
    });

    it("falls back to message.content", () => {
      expect(extractReply({ message: { content: "b" } })).toBe("b");
    });

    it("falls back to reply", () => {
      expect(extractReply({ reply: "c" })).toBe("c");
    });

    it("returns '' for unknown shape", () => {
      expect(extractReply({ foo: "bar" })).toBe("");
      expect(extractReply(null)).toBe("");
    });

    it("passes through plain string", () => {
      expect(extractReply("raw")).toBe("raw");
    });
  });

  describe("streamAvailable()", () => {
    it("false when no electronAPI", () => {
      expect(streamAvailable()).toBe(false);
    });

    it("false when queryStream missing", () => {
      installMockLlm({});
      expect(streamAvailable()).toBe(false);
    });

    it("true when queryStream + on both exposed", () => {
      installMockLlm({
        queryStream: vi.fn(),
        on: vi.fn(),
      });
      expect(streamAvailable()).toBe(true);
    });

    it("false when only queryStream exposed (no on)", () => {
      installMockLlm({ queryStream: vi.fn() });
      expect(streamAvailable()).toBe(false);
    });
  });

  describe("sendChatStream()", () => {
    function captureListener(): {
      on: ReturnType<typeof vi.fn>;
      off: ReturnType<typeof vi.fn>;
      emit: (payload: StreamChunkPayload) => void;
      listener: () => void;
    } {
      let saved: ((p: StreamChunkPayload) => void) | null = null;
      const on = vi.fn((_evt: string, l: (p: StreamChunkPayload) => void) => {
        saved = l;
      });
      const off = vi.fn();
      return {
        on,
        off,
        emit: (payload) => {
          if (saved) saved(payload);
        },
        listener: () => saved as unknown as () => void,
      };
    }

    it("returns unavailable when electronAPI is missing", async () => {
      const r = await sendChatStream("hi", () => {});
      expectFailure(r);
      expect(r.reason).toMatch(/queryStream/);
    });

    it("returns unavailable when queryStream is missing", async () => {
      installMockLlm({ on: vi.fn(), off: vi.fn() });
      const r = await sendChatStream("hi", () => {});
      expect(r.ok).toBe(false);
    });

    it("returns error on empty prompt", async () => {
      installMockLlm({ queryStream: vi.fn(), on: vi.fn(), off: vi.fn() });
      const r = await sendChatStream("   ", () => {});
      expectFailure(r);
      expect(r.reason).toMatch(/空/);
    });

    it("accumulates chunks and resolves with fullText", async () => {
      const cap = captureListener();
      const queryStream = vi.fn(async () => {
        cap.emit({ chunk: "Hel" });
        cap.emit({ chunk: "lo " });
        cap.emit({ chunk: "world" });
        return { content: "Hello world" };
      });
      installMockLlm({ queryStream, on: cap.on, off: cap.off });
      const seen: string[] = [];
      const r = await sendChatStream("hi", (s) => seen.push(s));
      expect(r).toEqual({ ok: true, reply: "Hello world" });
      expect(seen).toEqual(["Hel", "Hello ", "Hello world"]);
      expect(cap.on).toHaveBeenCalledWith(
        "llm:stream-chunk",
        expect.any(Function),
      );
      expect(cap.off).toHaveBeenCalledWith(
        "llm:stream-chunk",
        expect.any(Function),
      );
    });

    it("prefers fullText field when present in payload", async () => {
      const cap = captureListener();
      const queryStream = vi.fn(async () => {
        cap.emit({ chunk: "Hel", fullText: "Hel" });
        cap.emit({ chunk: "lo", fullText: "Hello" });
        return {};
      });
      installMockLlm({ queryStream, on: cap.on, off: cap.off });
      const seen: string[] = [];
      const r = await sendChatStream("hi", (s) => seen.push(s));
      expect(seen).toEqual(["Hel", "Hello"]);
      expect(r).toEqual({ ok: true, reply: "Hello" });
    });

    it("falls back to accumulated chunks when queryStream returns empty", async () => {
      const cap = captureListener();
      const queryStream = vi.fn(async () => {
        cap.emit({ chunk: "accu" });
        cap.emit({ chunk: "mulated" });
        return null;
      });
      installMockLlm({ queryStream, on: cap.on, off: cap.off });
      const r = await sendChatStream("hi", () => {});
      expect(r).toEqual({ ok: true, reply: "accumulated" });
    });

    it("returns error when nothing was streamed and return is empty", async () => {
      const cap = captureListener();
      const queryStream = vi.fn(async () => null);
      installMockLlm({ queryStream, on: cap.on, off: cap.off });
      const r = await sendChatStream("hi", () => {});
      expectFailure(r);
      expect(r.reason).toMatch(/空/);
    });

    it("catches thrown errors and still cleans up listener", async () => {
      const cap = captureListener();
      const queryStream = vi.fn(async () => {
        throw new Error("upstream down");
      });
      installMockLlm({ queryStream, on: cap.on, off: cap.off });
      const r = await sendChatStream("hi", () => {});
      expect(r).toEqual({ ok: false, reason: "upstream down" });
      expect(cap.off).toHaveBeenCalledTimes(1);
    });
  });
});
