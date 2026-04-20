import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAvailable,
  sendChat,
  toBridgeMessages,
  __testing,
  type BridgeResult,
} from "../llm-preview-bridge";

function expectFailure(
  r: BridgeResult,
): asserts r is { ok: false; reason: string } {
  if (r.ok) throw new Error("expected failure, got success");
}

interface MockLlm {
  checkStatus: ReturnType<typeof vi.fn>;
  chat: ReturnType<typeof vi.fn>;
}

function installMockLlm(mock: Partial<MockLlm>): MockLlm {
  const full: MockLlm = {
    checkStatus: mock.checkStatus ?? vi.fn(),
    chat: mock.chat ?? vi.fn(),
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
});
