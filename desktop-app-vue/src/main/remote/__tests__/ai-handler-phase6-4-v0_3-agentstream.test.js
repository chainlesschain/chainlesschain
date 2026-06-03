/**
 * AICommandHandler — Phase 6.4 v0.3 测试
 *
 * 覆盖 Agent streaming:
 *   runAgentStream → 返 streamId + 异步累积 chunks
 *   reuse getStreamChunk (poll) / cancelStream (cancel) 与 chat 共用
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const Database = require("better-sqlite3-multiple-ciphers");
const AICommandHandler = require("../handlers/ai-handler");

describe("AICommandHandler — Phase 6.4 v0.3 (runAgentStream)", () => {
  let db;
  const ctx = { did: "did:test:phone" };

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    db.close();
  });

  async function flush(ms = 20) {
    await new Promise((r) => setTimeout(r, ms));
  }

  describe("runAgentStream — runStream path", () => {
    it("returns streamId and accumulates chunks", async () => {
      const fake = {
        agents: {
          runStream: vi.fn(async (_id, _input, _opts, onChunk) => {
            onChunk("Hello ");
            onChunk("world");
            await flush(5);
            onChunk("!");
          }),
        },
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "runAgentStream",
        { agentId: "a1", input: "x" },
        ctx,
      );
      expect(r.streamId).toMatch(/^agent_/);
      expect(r.agentId).toBe("a1");

      // 等 async runStream 完成
      await flush(40);

      const poll = await handler.handle(
        "getStreamChunk",
        { streamId: r.streamId, sinceChunk: 0 },
        ctx,
      );
      expect(poll.chunks.join("")).toBe("Hello world!");
      expect(poll.isComplete).toBe(true);
    });

    it("accepts {content} chunk object format", async () => {
      const fake = {
        agents: {
          runStream: async (_id, _input, _opts, onChunk) => {
            onChunk({ content: "obj-chunk-1" });
            onChunk({ content: "obj-chunk-2" });
          },
        },
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "runAgentStream",
        { agentId: "a1", input: "x" },
        ctx,
      );
      await flush(30);
      const poll = await handler.handle(
        "getStreamChunk",
        { streamId: r.streamId, sinceChunk: 0 },
        ctx,
      );
      expect(poll.chunks).toEqual(["obj-chunk-1", "obj-chunk-2"]);
    });

    it("incremental poll respects sinceChunk", async () => {
      const fake = {
        agents: {
          runStream: async (_id, _input, _opts, onChunk) => {
            onChunk("A");
            await flush(5);
            onChunk("B");
            await flush(5);
            onChunk("C");
          },
        },
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "runAgentStream",
        { agentId: "a1", input: "x" },
        ctx,
      );
      await flush(15);
      const p1 = await handler.handle(
        "getStreamChunk",
        { streamId: r.streamId, sinceChunk: 0 },
        ctx,
      );
      const sinceNext = p1.nextChunkIdx;
      await flush(30);
      const p2 = await handler.handle(
        "getStreamChunk",
        { streamId: r.streamId, sinceChunk: sinceNext },
        ctx,
      );
      const all = [...p1.chunks, ...p2.chunks].join("");
      expect(all).toBe("ABC");
      expect(p2.isComplete).toBe(true);
    });
  });

  describe("runAgentStream — run fallback path", () => {
    it("falls back to non-streaming run when runStream absent", async () => {
      const fake = {
        agents: {
          run: vi.fn(async () => ({ output: "full output" })),
        },
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "runAgentStream",
        { agentId: "a1", input: "x" },
        ctx,
      );
      await flush(30);
      const poll = await handler.handle(
        "getStreamChunk",
        { streamId: r.streamId, sinceChunk: 0 },
        ctx,
      );
      expect(poll.chunks).toEqual(["full output"]);
      expect(poll.isComplete).toBe(true);
    });

    it("fallback receives onChunk in options (for run-with-callback agents)", async () => {
      let receivedOnChunk;
      const fake = {
        agents: {
          run: async (_id, _input, opts) => {
            receivedOnChunk = opts.onChunk;
            receivedOnChunk("partial-1");
            receivedOnChunk("partial-2");
            return { output: "" };
          },
        },
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "runAgentStream",
        { agentId: "a1", input: "x" },
        ctx,
      );
      await flush(30);
      const poll = await handler.handle(
        "getStreamChunk",
        { streamId: r.streamId, sinceChunk: 0 },
        ctx,
      );
      expect(poll.chunks).toEqual(["partial-1", "partial-2"]);
    });
  });

  describe("runAgentStream — error / cancel paths", () => {
    it("captures error from agent execution", async () => {
      const fake = {
        agents: {
          runStream: async () => {
            throw new Error("agent crashed");
          },
        },
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "runAgentStream",
        { agentId: "a1", input: "x" },
        ctx,
      );
      await flush(30);
      const poll = await handler.handle(
        "getStreamChunk",
        { streamId: r.streamId, sinceChunk: 0 },
        ctx,
      );
      expect(poll.isComplete).toBe(true);
      expect(poll.error).toContain("agent crashed");
    });

    it("cancelStream stops further chunk accumulation", async () => {
      let onChunkRef;
      const fake = {
        agents: {
          runStream: async (_id, _input, _opts, onChunk) => {
            onChunkRef = onChunk;
            // 模拟长跑：不返回直到外部 cancel
            await new Promise((r) => setTimeout(r, 200));
          },
        },
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "runAgentStream",
        { agentId: "a1", input: "x" },
        ctx,
      );
      await flush(15);
      // 在 cancel 前推 1 个 chunk
      onChunkRef("before-cancel");
      const cancel = await handler.handle(
        "cancelStream",
        { streamId: r.streamId },
        ctx,
      );
      expect(cancel.cancelled).toBe(true);
      // cancel 后再推不该被收
      onChunkRef("after-cancel");
      const poll = await handler.handle(
        "getStreamChunk",
        { streamId: r.streamId, sinceChunk: 0 },
        ctx,
      );
      expect(poll.chunks).toEqual(["before-cancel"]);
      expect(poll.isComplete).toBe(true);
    });

    it("throws on missing agentId", async () => {
      const handler = new AICommandHandler(
        { agents: { runStream: vi.fn() } },
        null,
        db,
        {},
      );
      await expect(
        handler.handle("runAgentStream", { input: "x" }, ctx),
      ).rejects.toThrow("agentId is required");
    });

    it("throws on null input", async () => {
      const handler = new AICommandHandler(
        { agents: { runStream: vi.fn() } },
        null,
        db,
        {},
      );
      await expect(
        handler.handle("runAgentStream", { agentId: "a1", input: null }, ctx),
      ).rejects.toThrow("input is required");
    });

    it("throws when agent manager absent", async () => {
      const handler = new AICommandHandler({}, null, db, {});
      await expect(
        handler.handle("runAgentStream", { agentId: "a1", input: "x" }, ctx),
      ).rejects.toThrow("Agent manager not available");
    });
  });
});
